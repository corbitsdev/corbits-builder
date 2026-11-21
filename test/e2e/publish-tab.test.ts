import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createArtifact } from "@corbits/artifacts";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import type { PlanView } from "@corbits-builder/schemas/project";

// The hub reads its plugins once, from the repository's plugins folder, when it loads. A place to
// publish to is copied there: the hoster fixture and its plan, listed in the publish group, and
// resolving their imports through the hub's own dependencies.
const ROOT = join(import.meta.dir, "../..");
const PLACES = ["hoster", "hoster-publish"];
for (const folder of PLACES) {
  const installed = join(ROOT, "plugins", folder);
  await rm(installed, { recursive: true, force: true });
  await cp(join(ROOT, "apps/hub/src/plugins/fixtures", folder), installed, {
    recursive: true,
  });
  await symlink(
    join(ROOT, "apps/hub/node_modules"),
    join(installed, "node_modules"),
  );
  const manifest = await Bun.file(join(installed, "package.json")).json();
  manifest.builder.groups = ["publish"];
  if (manifest.builder.runs === "plan") manifest.builder.ends = "app_exists";
  await writeFile(join(installed, "package.json"), JSON.stringify(manifest));
}
const { startInProcessHub } = await import("./support/in-process-hub.ts");

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(async () => {
  hub?.close();
  for (const folder of PLACES)
    await rm(join(ROOT, "plugins", folder), { recursive: true, force: true });
});

// A project with a saved app, as a coder's passing check files it.
async function savedApp() {
  const seeded = await hub.seedProject("Publish");
  const { person } = seeded;
  const content = JSON.stringify({ files: { "package.json": "{}" } });
  await hub.db.transaction((tx) =>
    createArtifact(tx, {
      scope: person,
      title: "App",
      content,
      metadata: { source: "check", bytes: Buffer.byteLength(content) },
      ownerPrincipalId: person.principalId,
      kind: "app",
      source: { origin: "workflow" },
    }),
  );
  return seeded;
}

const publishTab = async (path: string, credentials?: { cookie: string }) =>
  (
    await hub.json<PlanView>(
      hub.call("GET", `${path}/plan`, undefined, credentials),
    )
  ).screens.find(
    ({ plugin, action }) => plugin === "publish" && action === "published",
  );

test("the link to keep a published app reaches only someone who manages the project", async () => {
  const { path, person, projectId } = await savedApp();
  const keep = {
    link: "https://dash.example.com/claim?token=e2e-only-keep-token",
    until: new Date(Date.now() + 60 * 60_000).toISOString(),
    place: "Hoster",
  };
  await hub.call("POST", `${path}/values`, {
    values: { "publish.keep": keep },
  });
  expect((await publishTab(path))?.state).toMatchObject({
    keep: { link: keep.link, place: "Hoster", passed: false },
  });
  const reader = await hub.seedMember(person, projectId, ["read"]);
  expect((await publishTab(path, reader))?.state).toMatchObject({
    keep: null,
  });
});

test("a run's read of the plan lists no screen and nothing prepared for one, since either may hold what no model may read", async () => {
  const { path, person, projectId } = await savedApp();
  const coordinator = await hub.seedRun(person, "coordinator", true);
  await hub.db.execute(
    sql`insert into project_coordinator (run_id, project_id, registered_by) values (${coordinator.id}, ${projectId}, ${person.principalId})`,
  );
  for (const action of ["read", "manage"])
    await hub.db.insert(grant).values({
      id: randomUUID(),
      tenantId: person.tenantId,
      principalId: coordinator.principalId,
      resource: `sb-project:${projectId}`,
      action,
      effect: "allow",
      origin: "system",
    });
  const tokens = createRunTokenStore({
    db: hub.db,
    cipher: createNoopCredentialCipher(),
  });
  await tokens.mintIfAbsent(
    {
      principalId: coordinator.principalId,
      consumers: [toolConsumer("question")],
    },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(coordinator.principalId);
  const run = { authorization: `Bearer ${delivery!.token}` };
  expect(await publishTab(path)).toBeDefined();
  const read = await hub.json<PlanView>(
    hub.call("GET", `${path}/plan`, undefined, run),
  );
  expect(read.screens).toEqual([]);
  expect(read.asked).toEqual([]);
});
