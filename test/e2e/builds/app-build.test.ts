import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";
import { createArtifact } from "@corbits/artifacts";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import { startInProcessHub } from "../support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(() => hub?.close());

// The person's session, unless a test calls with a run's token.
async function answer(path: string, credentials?: Record<string, string>) {
  return hub.call("GET", path, undefined, credentials).then(
    (response) => response,
    (error: Error) => error.message,
  );
}

// A project whose saved app is these files, with values saying how it is built for production.
async function project(
  title: string,
  files: Record<string, string>,
  values: Record<string, unknown>,
) {
  const seeded = await hub.seedProject(title);
  if (Object.keys(values).length > 0)
    await hub.call("POST", `${seeded.path}/values`, { values });
  const content = JSON.stringify({ files });
  await hub.db.transaction((tx) =>
    createArtifact(tx, {
      scope: seeded.person,
      ownerPrincipalId: seeded.person.principalId,
      kind: "app",
      title: "App",
      content,
      source: { origin: "workflow" },
      metadata: { source: "import", bytes: Buffer.byteLength(content) },
    }),
  );
  return seeded;
}

const production = (install: string, build: string) => ({
  "stack.production": {
    install,
    build,
    start: "true",
    port: "PORT",
    data: [],
  },
});

const SOURCE = { "package.json": "{}", "src/page.txt": "page" };

const builtPaths = async (response: Response) => {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
};

// A run the coordinator started for server publish in the project and its token; with read, it holds
// the project read its package's grant requirements give it.
async function publishingRun(
  person: { tenantId: string; principalId: string },
  projectId: string,
  read: boolean,
) {
  const path = `/api/tenants/${person.tenantId}/projects/${projectId}`;
  const run = await hub.seedRun(person, "server", true);
  await hub.call("POST", `${path}/run-actions`, {
    runId: run.id,
    plugin: "server",
    action: "publish",
  });
  if (read)
    await hub.db.insert(grant).values({
      id: randomUUID(),
      tenantId: person.tenantId,
      principalId: run.principalId,
      resource: `sb-project:${projectId}`,
      action: "read",
      effect: "allow",
      origin: "system",
    });
  const tokens = createRunTokenStore({
    db: hub.db,
    cipher: createNoopCredentialCipher(),
  });
  await tokens.mintIfAbsent(
    {
      principalId: run.principalId,
      consumers: [toolConsumer("@corbits-builder/server/tools")],
    },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(run.principalId);
  return { authorization: `Bearer ${delivery!.token}` };
}

test("a publishing run builds its own project's saved app, and nothing of a project it cannot read", async () => {
  const build = production("mkdir dist", "echo page > dist/index.html");
  const own = await project("Own", SOURCE, build);
  const token = await publishingRun(own.person, own.projectId, true);
  const built = await hub.call(
    "GET",
    `${own.path}/app/build-archive?path=dist`,
    undefined,
    token,
  );
  expect(built.headers.get(APP_VERSION_HEADER)).toBe("v1");
  expect(await builtPaths(built)).toEqual(["dist/index.html"]);

  // Another person's project, in a tenant the run is not in.
  const other = await project("Other", SOURCE, build);
  expect(
    await answer(`${other.path}/app/build-archive?path=dist`, token),
  ).toStartWith("HTTP 401");
  // A run of the project that holds no read on it.
  const unread = await publishingRun(own.person, own.projectId, false);
  expect(await answer(`${own.path}/app/build-archive?path=dist`, unread)).toBe(
    'HTTP 403: {"code":"forbidden"}',
  );
  // The route is a read: the run cannot reach it any other way.
  await expect(
    hub.call("POST", `${own.path}/app/build-archive?path=dist`, {}, token),
  ).rejects.toThrow("HTTP 401");
}, 120_000);

// The coder's web-app starter as a project's saved app, the way a first build files it.
async function starterFiles() {
  const root = join(import.meta.dir, "../../../plugins/coder/starter");
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    const full = join(entry.parentPath, entry.name);
    if (
      !entry.isFile() ||
      /(^|\/)(node_modules|dist)\//.test(relative(root, full))
    )
      continue;
    files[relative(root, full)] = await readFile(full, "utf8");
  }
  return files;
}

test("the web-app starter installs and builds as it would for production, and hands back its built client", async () => {
  const { path } = await project("Starter", await starterFiles(), {
    "stack.starter": "web-app",
  });
  const built = await hub.call(
    "GET",
    `${path}/app/build-archive?path=client/dist`,
  );
  const paths = await builtPaths(built);
  expect(paths).toContain("client/dist/index.html");
  expect(
    paths.some((name) => /^client\/dist\/assets\/.+\.js$/.test(name)),
  ).toBe(true);
  expect(paths.every((name) => name.startsWith("client/dist/"))).toBe(true);
}, 600_000);
