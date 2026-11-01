import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { createDB } from "@intx/db";
import {
  principal,
  workflowDefinition,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import {
  createIsogitStore,
  createMailAuditStore,
} from "@intx/storage-isogit/node";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { migrateDatabase } from "@corbits-builder/hub/migrate";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

const writer = {
  projection: {
    steps: { write: { agent: { tags: { "writer.version": "1" } } } },
  },
};

// The hub's own notice loop on real Postgres. The coordinator run has no deployment behind it, so
// the native run mail route fails the older notice with a 500; the later one's stored assignment
// cannot be decoded.
test("an undeliverable notice does not hold back a later notice", async () => {
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  const dbName = `sb_notice_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres({
    ...database,
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
  await admin.unsafe(`create database ${dbName}`);
  const directory = await mkdtemp(join(tmpdir(), "sb-notice-"));
  const origin = "http://127.0.0.1:1";
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    // Never bound: requests go straight to the app.
    PORT: "1",
    DB_HOST: database.host,
    DB_PORT: String(database.port),
    DB_USER: database.username,
    DB_PASSWORD: database.password,
    DB_NAME: dbName,
    DB_SSL: "false",
    BETTER_AUTH_BASE_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PRINCIPAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HUB_DATA_DIR: join(directory, "hub"),
  };
  const handle = createDB({
    ...database,
    user: database.username,
    database: dbName,
    ssl: false,
  });
  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  try {
    await migrateDatabase(environment);
    runtime = await createHubRuntime(environment);
    const call = (path: string, body: object, cookie = "") =>
      runtime!.app.fetch(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", cookie },
          body: JSON.stringify(body),
        }),
      );
    const signUp = await call("/api/auth/sign-up/email", {
      email: `notice-${dbName}@example.invalid`,
      password: randomBytes(16).toString("hex"),
      name: "Notice e2e",
    });
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await call(
      "/api/tenants",
      { name: "Notice e2e", slug: dbName.replaceAll("_", "-") },
      cookie,
    );
    const tenantId = ((await created.json()) as { id: string }).id;
    const [person] = await handle.db
      .select({ id: principal.id })
      .from(principal)
      .where(and(eq(principal.tenantId, tenantId), eq(principal.kind, "user")));

    const run = async (
      values: Partial<typeof workflowRun.$inferInsert>,
      bundle: object = writer,
    ) => {
      const id = randomUUID();
      await handle.db
        .insert(workflowDefinition)
        .values({ id, tenantId, name: id });
      await handle.db.insert(workflowRun).values({
        id,
        definitionId: id,
        anchorRunId: id,
        tenantId,
        address: `${id}@${tenantId}.test`,
        ...values,
      });
      await handle.db.insert(workflowRunLaunchSpec).values({
        anchorRunId: id,
        sessionId: id,
        deploymentDomain: `${tenantId}.test`,
        sourceAuthorityPrincipalId: person!.id,
        frozenApprovalBundle: bundle,
        sourceOfferingIds: [],
        defaultSourceOfferingId: "offering",
        deployContent: {},
      });
      return id;
    };
    // A writer that ended cancelled with one unanswered assignment in its stored mail.
    const endedWriter = async (secondsAgo: number, ...headers: string[]) => {
      const id = await run({
        status: "cancelled",
        cancellationReason: "stopped",
        endedAt: new Date(Date.now() - secondsAgo * 1_000),
      });
      const mailDirectory = join(
        environment["HUB_DATA_DIR"]!,
        "report-mail",
        id,
      );
      await createIsogitStore(mailDirectory);
      const journal = await createMailAuditStore(mailDirectory);
      await journal.commitMail(
        new TextEncoder().encode(
          [
            `Date: ${new Date(Date.now() - 60_000).toUTCString()}`,
            `Message-ID: <${id}-assignment@${tenantId}.test>`,
            `Interchange-Correlation-ID: writer-draft-${id}`,
            ...headers,
            "",
            "Write the draft.",
            "",
          ].join("\r\n"),
        ),
        "in",
      );
      return id;
    };

    const blocked = await endedWriter(2);
    const later = await endedWriter(1, "Content-Type: multipart/mixed");
    const coordinator = await run({ status: "running" }, {});
    await handle.db.execute(
      sql`insert into project (id, tenant_id, title) values (${tenantId}, ${tenantId}, 'Notice e2e')`,
    );
    await handle.db.execute(
      sql`insert into project_coordinator (run_id, project_id, registered_by) values (${coordinator}, ${tenantId}, ${person!.id})`,
    );

    const notified = async (runId: string) => {
      const rows = await handle.db.execute<{ notified: boolean }>(
        sql`select notified from sb_ended_run where run_id = ${runId}`,
      );
      return rows[0]?.notified;
    };
    runtime.start();
    // Allows two of the loop's 5 s retries before failing.
    let settled: boolean | undefined;
    for (let i = 0; i < 120 && settled === undefined; i++) {
      await Bun.sleep(100);
      settled = await notified(later);
    }
    expect(settled).toBe(false);
    expect(await notified(blocked)).toBe(false);
  } finally {
    await runtime?.close();
    await handle.close();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
