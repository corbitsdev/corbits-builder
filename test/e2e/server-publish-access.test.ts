import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createArtifact } from "@corbits/artifacts";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(() => hub?.close());

const PRODUCTION = {
  install: "bun install --frozen-lockfile",
  build: "bun run build",
  start: "bun run start",
  port: "PORT",
  data: ["server/data"],
};

// A project with a saved app and how it runs in production, and a run the coordinator started for
// server publish there, holding the project read its package's grant requirements give it.
async function publishing(title: string) {
  const { projectId, person, path } = await hub.seedProject(title);
  await hub.call("POST", `${path}/values`, {
    values: { "stack.production": PRODUCTION },
  });
  const content = JSON.stringify({ files: { "package.json": "{}" } });
  await hub.db.transaction((tx) =>
    createArtifact(tx, {
      scope: person,
      ownerPrincipalId: person.principalId,
      kind: "app",
      title: "App",
      content,
      source: { origin: "workflow" },
      metadata: { source: "import", bytes: Buffer.byteLength(content) },
    }),
  );
  const run = await hub.seedRun(person, "server", true);
  await hub.call("POST", `${path}/run-actions`, {
    runId: run.id,
    plugin: "server",
    action: "publish",
  });
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
  return { path, token: { authorization: `Bearer ${delivery!.token}` } };
}

test("a server publish run downloads its project's saved app and reads the values its action reads, and nothing of another project", async () => {
  const { path, token } = await publishing("Published");
  const other = await publishing("Other");

  const archive = await hub.call(
    "GET",
    `${path}/app/archive`,
    undefined,
    token,
  );
  expect(archive.headers.get(APP_VERSION_HEADER)).toBe("v1");
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  expect(
    Object.keys(zip.files).some((name) => name.endsWith("/package.json")),
  ).toBe(true);
  expect(
    await hub.json(
      hub.call(
        "GET",
        `${path}/run-values?keys=stack.production,publish.release`,
        undefined,
        token,
      ),
    ),
  ).toEqual({
    values: { "stack.production": PRODUCTION, "publish.release": null },
  });
  const release = {
    target: "server",
    url: "http://203.0.113.7/",
    version: "v1",
    at: "2026-11-17T10:00:00.000Z",
  };
  expect(
    await hub.json(
      hub.call(
        "POST",
        `${path}/run-values`,
        { values: { "publish.release": release } },
        token,
      ),
    ),
  ).toEqual({ values: { "publish.release": release } });

  // A value its action does not read, any value through the general route, and anything of
  // another project, are refused.
  await expect(
    hub.call("GET", `${path}/run-values?keys=stack.run`, undefined, token),
  ).rejects.toThrow("run_value_not_read");
  await expect(
    hub.call("GET", `${path}/values?keys=stack.production`, undefined, token),
  ).rejects.toThrow("HTTP 401");
  await expect(
    hub.call("GET", `${other.path}/app/archive`, undefined, token),
  ).rejects.toThrow("HTTP 401");
  await expect(
    hub.call(
      "GET",
      `${other.path}/run-values?keys=stack.production`,
      undefined,
      token,
    ),
  ).rejects.toThrow("HTTP 401");
  await expect(
    hub.call("POST", `${path}/app/archive`, {}, token),
  ).rejects.toThrow("HTTP 401");
});
