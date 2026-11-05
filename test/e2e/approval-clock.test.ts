import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import postgres from "postgres";
import { createArtifact, writeArtifactVersion } from "@corbits/artifacts";
import { createDB } from "@intx/db";
import { createArtifactService } from "@corbits-builder/hub/artifacts/service";
import { readDatabaseConfig } from "@corbits-builder/hub/environment";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { createTestDatabase } from "./support/hub.ts";

// The database stamps an ask and the hub stamps a document's versions; their clocks disagree
// by this much, either way.
const SKEW_MS = 5 * 60 * 1000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDB>;
let sql: postgres.Sql;
let service: ReturnType<typeof createArtifactService>;

beforeAll(async () => {
  database = await createTestDatabase();
  await migrateDatabase(database.env);
  const config = readDatabaseConfig(database.env);
  handle = createDB(config);
  sql = postgres({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 1,
    onnotice: () => undefined,
  });
  service = createArtifactService(
    handle.db,
    {} as Parameters<typeof createArtifactService>[1],
  );
});

afterAll(async () => {
  await sql?.end();
  await handle?.close();
  await database?.drop();
});

type Scope = { tenantId: string; principalId: string; projectId: string };

async function seed(): Promise<Scope> {
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const scope = {
    tenantId: `tnt_${id}`,
    principalId: `prn_${id}`,
    projectId: `project-${id}`,
  };
  await sql`insert into tenant (id, name, slug, domain) values (${scope.tenantId}, ${id}, ${id}, ${`${id}.localhost`})`;
  await sql`insert into principal (id, tenant_id, kind, ref_id, status) values (${scope.principalId}, ${scope.tenantId}, 'user', ${id}, 'active')`;
  await sql`insert into "grant" (id, tenant_id, principal_id, resource, action, effect, origin) values (${`grt_${id}`}, ${scope.tenantId}, ${scope.principalId}, ${`sb-project:${scope.projectId}`}, 'manage', 'allow', 'system')`;
  await sql`insert into project (id, tenant_id, title) values (${scope.projectId}, ${scope.tenantId}, ${id})`;
  await sql`insert into workflow_definition (id, tenant_id, name) values (${`wfd_${id}`}, ${scope.tenantId}, ${id})`;
  await sql`insert into workflow_run (id, tenant_id, definition_id) values (${`run_${id}`}, ${scope.tenantId}, ${`wfd_${id}`})`;
  return scope;
}

// Runs a hub step with the hub's clock skewed from the database's.
async function onHubClock<T>(skewMs: number, step: () => Promise<T>) {
  setSystemTime();
  setSystemTime(new Date(Date.now() + skewMs));
  try {
    return await step();
  } finally {
    setSystemTime();
  }
}

// Keeps the steps' wall-clock order distinct at millisecond resolution.
const pause = () => Bun.sleep(20);

async function file(scope: Scope, skewMs: number) {
  const row = await onHubClock(skewMs, () =>
    handle.db.transaction((tx) =>
      createArtifact(tx, {
        scope,
        ownerPrincipalId: scope.principalId,
        kind: "problem_brief",
        title: "Brief",
        content: "first",
        source: {},
      }),
    ),
  );
  return {
    artifactId: row.id,
    kind: "problem_brief",
    version: row.version,
    sha256: row.contentSha256!,
  };
}

async function revise(scope: Scope, artifactId: string, skewMs: number) {
  const row = await onHubClock(skewMs, () =>
    writeArtifactVersion(handle.db, { scope, artifactId, content: "second" }),
  );
  return {
    artifactId,
    kind: "problem_brief",
    version: row.version,
    sha256: row.contentSha256!,
  };
}

// The person is asked and approves; the database stamps when they were asked.
async function askAndApprove(scope: Scope) {
  const approvalId = `apr_${crypto.randomUUID()}`;
  const runId = `run_${scope.tenantId.slice(4)}`;
  await sql`insert into approval (id, tenant_id, anchor_run_id, run_id, agent_address, correlation_id, tool_definition, tool_arguments, status, resolved_at)
    values (${approvalId}, ${scope.tenantId}, ${runId}, ${runId}, 'coordinator@localhost', ${approvalId}, ${sql.json({ name: "request_approval" })}, ${sql.json({ kinds: ["problem_brief"] })}, 'approved', now())`;
  return approvalId;
}

function record(
  scope: Scope,
  ref: Awaited<ReturnType<typeof file>>,
  skewMs: number,
) {
  return onHubClock(skewMs, () =>
    service.recordApproval(scope, scope.projectId, {
      tool: "request_approval",
      artifacts: [ref],
    }),
  );
}

for (const skewMs of [SKEW_MS, -SKEW_MS]) {
  const clocks = `with the hub's clock ${skewMs > 0 ? "ahead of" : "behind"} the database's`;

  test(`${clocks}, a document written before the ask is approved`, async () => {
    const scope = await seed();
    const ref = await file(scope, skewMs);
    await pause();
    const approvalId = await askAndApprove(scope);
    await pause();
    expect(await record(scope, ref, skewMs)).toEqual({
      approvalId,
      artifacts: [ref],
    });
  });

  test(`${clocks}, a document revised after the ask is refused`, async () => {
    const scope = await seed();
    const first = await file(scope, skewMs);
    await pause();
    await askAndApprove(scope);
    await pause();
    const revised = await revise(scope, first.artifactId, skewMs);
    await pause();
    await expect(record(scope, revised, skewMs)).rejects.toMatchObject({
      code: "artifact_changed_during_approval",
    });
  });

  test(`${clocks}, an approval already recorded records nothing more`, async () => {
    const scope = await seed();
    const ref = await file(scope, skewMs);
    await pause();
    const approvalId = await askAndApprove(scope);
    await pause();
    await record(scope, ref, skewMs);
    expect(await record(scope, ref, skewMs)).toEqual({
      approvalId,
      artifacts: [],
    });
  });
}
