import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import JSZip from "jszip";
import { createArtifact } from "@corbits/artifacts";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import { startInProcessHub } from "../support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

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
// Build output the app's author writes, which never reaches the caller.
const MARKER = "printed-by-the-app-build";

const builtPaths = async (response: Response) => {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
};

test("a person builds the saved app and gets only the paths asked for, with the version built", async () => {
  const { path } = await project(
    "Built",
    SOURCE,
    production(
      "mkdir -p dist/site/assets",
      `cp src/page.txt dist/site/index.html && echo css > dist/site/assets/a.css && echo map > dist/map.txt && echo ${MARKER}`,
    ),
  );
  const built = await hub.call(
    "GET",
    `${path}/app/build-archive?path=dist/site`,
  );
  expect(built.headers.get(APP_VERSION_HEADER)).toBe("v1");
  expect(built.headers.get("content-type")).toBe("application/zip");
  expect(await builtPaths(built)).toEqual([
    "dist/site/assets/a.css",
    "dist/site/index.html",
  ]);
}, 120_000);

test("a build is refused with a fixed code that carries nothing the build printed", async () => {
  const route = (path: string, query: string) =>
    answer(`${path}/app/build-archive${query}`);
  const failing = async (install: string, build: string) =>
    (await project("Failing", SOURCE, production(install, build))).path;

  const fine = await failing("true", "mkdir -p dist && ln -s .. dist/up");
  for (const query of [
    "",
    "?path=../etc",
    "?path=/etc",
    "?path=dist/",
    "?path=a\\b",
    "?path=./dist",
    `?${Array.from({ length: 9 }, (_, at) => `path=p${String(at)}`).join("&")}`,
  ])
    expect(await route(fine, query)).toStartWith(
      'HTTP 400: {"code":"invalid_build_paths"',
    );
  expect(await route(fine, "?path=client/dist")).toBe(
    'HTTP 422: {"code":"build_path_missing","path":"client/dist"}',
  );
  expect(await route(fine, "?path=dist/up")).toBe(
    'HTTP 422: {"code":"build_path_is_link","path":"dist/up"}',
  );
  // A link inside a requested folder is left out, so nothing of the app's root comes back.
  expect(
    await builtPaths(
      (await hub.call(
        "GET",
        `${fine}/app/build-archive?path=dist`,
      )) as Response,
    ),
  ).toEqual([]);

  const unproduced = (await project("Unproduced", SOURCE, {})).path;
  expect(await route(unproduced, "?path=dist")).toBe(
    'HTTP 409: {"code":"stack_production_missing"}',
  );
  const install = await failing(`echo ${MARKER}; exit 1`, "true");
  expect(await route(install, "?path=dist")).toBe(
    'HTTP 422: {"code":"install_failed"}',
  );
  const build = await failing("true", `echo ${MARKER} >&2; exit 2`);
  expect(await route(build, "?path=dist")).toBe(
    'HTTP 422: {"code":"build_failed"}',
  );
}, 120_000);

// An install step that marks its workspace with a name no other build uses, so the test knows the
// build is under way, then waits until the test puts that name's go file beside it.
const heldInstall = () => {
  const tag = `held-${randomUUID()}`;
  return {
    tag,
    install: `touch ${tag} && until [ -e ${tag}.go ]; do sleep 0.1; done`,
  };
};

// The workspace of the build whose install marked it with tag, once it did; refused if the build
// settled first.
async function underWay(tag: string, settled: Promise<unknown>) {
  let over = false;
  void settled.finally(() => {
    over = true;
  });
  const marker = new Bun.Glob(`command-check-*/workspace/${tag}`);
  while (!over) {
    for await (const found of marker.scan({
      cwd: tmpdir(),
      onlyFiles: true,
      absolute: true,
    }))
      return dirname(found);
    await Bun.sleep(50);
  }
  throw new Error("the build ended before its install began");
}

test("a second build of a project while one runs is refused", async () => {
  const { tag, install } = heldInstall();
  const { path } = await project(
    "Busy",
    SOURCE,
    production(install, "mkdir dist"),
  );
  const first = answer(`${path}/app/build-archive?path=dist`);
  const workspace = await underWay(tag, first);
  expect(await answer(`${path}/app/build-archive?path=dist`)).toBe(
    'HTTP 409: {"code":"app_command_running"}',
  );
  await writeFile(join(workspace, `${tag}.go`), "");
  expect(((await first) as Response).status).toBe(200);
}, 120_000);

test("a person builds the app only while they manage the project", async () => {
  const seeded = await project(
    "Shared",
    SOURCE,
    production("mkdir dist", "echo page > dist/index.html"),
  );
  const route = `${seeded.path}/app/build-archive?path=dist`;
  const reader = await hub.seedMember(seeded.person, seeded.projectId, [
    "read",
  ]);
  expect(await answer(route, reader)).toBe('HTTP 403: {"code":"forbidden"}');
  const manager = await hub.seedMember(seeded.person, seeded.projectId, [
    "read",
    "manage",
  ]);
  const built = await answer(route, manager);
  if (typeof built === "string") throw new Error(built);
  expect(await builtPaths(built)).toEqual(["dist/index.html"]);
}, 120_000);

test("a build whose caller goes away stops, and frees the project for its next build", async () => {
  const { tag, install } = heldInstall();
  const seeded = await project(
    "Abandoned",
    SOURCE,
    production(install, "mkdir dist"),
  );
  const route = `${seeded.path}/app/build-archive?path=dist`;
  const caller = new AbortController();
  const abandoned = hub
    .call("GET", route, undefined, undefined, caller.signal)
    .catch(() => undefined);
  await underWay(tag, abandoned);
  const left = Date.now();
  caller.abort();
  await abandoned;
  expect(Date.now() - left).toBeLessThan(20_000);
  await hub.call("POST", `${seeded.path}/values`, {
    values: production("true", "mkdir dist && echo page > dist/index.html"),
  });
  expect(await builtPaths(await hub.call("GET", route))).toEqual([
    "dist/index.html",
  ]);
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
