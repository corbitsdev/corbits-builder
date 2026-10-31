import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { createDB, type DB } from "@intx/db";
import {
  principal,
  tenant,
  workflowDefinition,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import type { WorkflowRunReader } from "@intx/hub-sessions";
import {
  createIsogitStore,
  createMailAuditStore,
} from "@intx/storage-isogit/node";
import {
  endedRun,
  project,
  projectCoordinator,
} from "@corbits-builder/hub/db/schema";
import { HubMailError } from "@corbits-builder/hub/mail/hub-mail";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { createSpecialistEndNotices } from "@corbits-builder/hub/projects/specialist-ended";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

let handle: DB;
let admin: postgres.Sql;
let mailDirectory: string;
let dbName: string;

beforeAll(() => {
  admin = postgres({
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
});

afterAll(async () => {
  await admin?.end();
});

// Each test gets its own database and mail store, so one test's pending notices never reach another.
beforeEach(async () => {
  dbName = `sb_notice_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create database ${dbName}`);
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    user: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  await migrateDatabase({
    DB_HOST: database.host,
    DB_PORT: String(database.port),
    DB_USER: database.user,
    DB_PASSWORD: database.password,
    DB_NAME: dbName,
    DB_SSL: "false",
  });
  handle = createDB({ ...database, database: dbName, ssl: false });
  mailDirectory = await mkdtemp(join(tmpdir(), "sb-notice-mail-"));
});

afterEach(async () => {
  await handle?.close();
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await rm(mailDirectory, { recursive: true, force: true });
});

const writerBundle = {
  projection: {
    steps: { write: { agent: { tags: { "writer.version": "1" } } } },
  },
};

// A tenant with one project, and its specialist that ended cancelled with an unanswered assignment.
async function endedSpecialist(name: string, endedAt: Date) {
  const db = handle.db;
  const tenantId = `${name}-${randomUUID()}`;
  await db.insert(tenant).values({
    id: tenantId,
    name: tenantId,
    slug: tenantId,
    domain: `${tenantId}.test`,
  });
  const principalId = `${tenantId}-person`;
  await db.insert(principal).values({
    id: principalId,
    tenantId,
    kind: "user",
    refId: principalId,
    status: "active",
  });
  const definitionId = `${tenantId}-definition`;
  await db
    .insert(workflowDefinition)
    .values({ id: definitionId, tenantId, name: definitionId });
  const projectId = `${tenantId}-project`;
  await db.insert(project).values({ id: projectId, tenantId, title: name });
  const run = async (
    id: string,
    values: Partial<typeof workflowRun.$inferInsert>,
    bundle: object,
  ) => {
    await db.insert(workflowRun).values({
      id,
      definitionId,
      anchorRunId: id,
      tenantId,
      address: `${id}@${tenantId}.test`,
      ...values,
    });
    await db.insert(workflowRunLaunchSpec).values({
      anchorRunId: id,
      sessionId: id,
      deploymentDomain: `${tenantId}.test`,
      sourceAuthorityPrincipalId: principalId,
      frozenApprovalBundle: bundle,
      sourceOfferingIds: [],
      defaultSourceOfferingId: "offering",
      deployContent: {},
    });
  };
  const specialistId = `${tenantId}-writer`;
  await run(
    specialistId,
    { status: "cancelled", cancellationReason: "stopped", endedAt },
    writerBundle,
  );
  const directory = join(mailDirectory, specialistId);
  await createIsogitStore(directory);
  const journal = await createMailAuditStore(directory);
  await journal.commitMail(
    new TextEncoder().encode(
      [
        `From: coordinator@${tenantId}.test`,
        `To: ${specialistId}@${tenantId}.test`,
        `Date: ${new Date(endedAt.getTime() - 60_000).toUTCString()}`,
        `Message-ID: <${specialistId}-assignment@${tenantId}.test>`,
        `Interchange-Correlation-ID: writer-draft-${specialistId}`,
        "Subject: draft",
        "",
        "Write the draft.",
        "",
      ].join("\r\n"),
    ),
    "in",
  );
  // Binds a new coordinator in place of the project's current one.
  const bindCoordinator = async (status: "running" | "failed" = "running") => {
    const coordinatorId = `${tenantId}-coordinator-${randomUUID()}`;
    await run(coordinatorId, { status }, {});
    await db
      .update(projectCoordinator)
      .set({ active: false })
      .where(eq(projectCoordinator.projectId, projectId));
    await db.insert(projectCoordinator).values({
      runId: coordinatorId,
      projectId,
      registeredBy: principalId,
    });
    return coordinatorId;
  };
  return { specialistId, bindCoordinator };
}

async function notice(runId: string) {
  const [row] = await handle.db
    .select()
    .from(endedRun)
    .where(eq(endedRun.runId, runId));
  return row;
}

// Mails like the native run mail route: a 409 for a coordinator run that has ended, and a 503 for
// the ones listed as unreachable.
function reconciler(unreachable: string[] = []) {
  let clock = Date.now();
  const delivered: string[] = [];
  const reconcileNext = createSpecialistEndNotices({
    db: handle.db,
    runs: {} as WorkflowRunReader,
    mailDirectory,
    mail: async ({ runId }) => {
      const [ended] = await handle.db
        .select({ id: workflowRun.id })
        .from(workflowRun)
        .where(
          and(
            eq(workflowRun.id, runId),
            inArray(workflowRun.status, ["completed", "failed", "cancelled"]),
          ),
        );
      if (ended) throw new HubMailError(409, "workflow_run_terminal");
      if (unreachable.includes(runId))
        throw new HubMailError(503, "unavailable");
      delivered.push(runId);
    },
    now: () => new Date(clock),
  });
  // Works through every notice due now.
  const drain = async () => {
    for (let pass = 0; pass < 20; pass += 1)
      if (!(await reconcileNext())) return;
    throw new Error("Notices never settled");
  };
  const later = () => {
    clock += 60 * 60_000;
  };
  return { delivered, drain, later };
}

test("an unreachable coordinator holds back only its own notice", async () => {
  const blocked = await endedSpecialist(
    "blocked",
    new Date(Date.now() - 2_000),
  );
  const other = await endedSpecialist("other", new Date(Date.now() - 1_000));
  const unreachable = await blocked.bindCoordinator();
  const reachable = await other.bindCoordinator();
  const { delivered, drain } = reconciler([unreachable]);

  await drain();
  expect(delivered).toEqual([reachable]);
  const pending = await notice(blocked.specialistId);
  expect(pending?.notified).toBe(false);
  expect(pending?.nextAttemptAt).not.toBeNull();
});

test("a notice for a project without a coordinator is delivered once one binds", async () => {
  const unbound = await endedSpecialist("unbound", new Date());
  const { delivered, drain, later } = reconciler();

  await drain();
  expect(delivered).toEqual([]);
  expect((await notice(unbound.specialistId))?.nextAttemptAt).not.toBeNull();
  const coordinator = await unbound.bindCoordinator();
  later();
  await drain();
  expect(delivered).toEqual([coordinator]);
  expect(await notice(unbound.specialistId)).toMatchObject({
    notified: true,
    nextAttemptAt: null,
  });
});

test("a notice for a project whose bound coordinator has ended is delivered to the next one", async () => {
  const stale = await endedSpecialist("stale", new Date());
  await stale.bindCoordinator("failed");
  const { delivered, drain, later } = reconciler();

  await drain();
  expect(delivered).toEqual([]);
  expect((await notice(stale.specialistId))?.nextAttemptAt).not.toBeNull();
  const coordinator = await stale.bindCoordinator();
  later();
  await drain();
  expect(delivered).toEqual([coordinator]);
  expect(await notice(stale.specialistId)).toMatchObject({
    notified: true,
    nextAttemptAt: null,
  });
});
