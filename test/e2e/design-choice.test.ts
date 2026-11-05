import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import {
  createArtifact,
  getArtifactVersion,
  writeArtifactVersion,
  type ArtifactDb,
} from "@corbits/artifacts";
import { createDB } from "@intx/db";
import {
  approval,
  principal,
  workflowDefinition,
  workflowRun,
} from "@intx/db/schema";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { migrateDatabase } from "@corbits-builder/hub/migrate";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

const bundle = (look: string) =>
  JSON.stringify({ files: { "index.html": `<main>${look}</main>` } });

// The design-choice route on real Postgres: each choose_design approval files one design, only
// for the concept it asked about, and covers the concept, so a look tweak the person saves while
// the card is open is filed with it.
test("a design choice files once, for the approved concept, tweaks included", async () => {
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  const dbName = `sb_choice_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres({
    ...database,
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
  await admin.unsafe(`create database ${dbName}`);
  const directory = await mkdtemp(join(tmpdir(), "sb-choice-"));
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
    // better-auth's sign-up limit is keyed by client IP and outlives a runtime in this process, so
    // this test signs up from its own address rather than share the other e2e files' bucket.
    const client = "198.51.100.42";
    const call = (path: string, body: object, cookie = "") =>
      runtime!.app.fetch(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-forwarded-for": client,
            cookie,
          },
          body: JSON.stringify(body),
        }),
      );
    const signUp = await call("/api/auth/sign-up/email", {
      email: `choice-${dbName}@example.invalid`,
      password: randomBytes(16).toString("hex"),
      name: "Choice e2e",
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await call(
      "/api/tenants",
      { name: "Choice e2e", slug: dbName.replaceAll("_", "-") },
      cookie,
    );
    expect(created.status).toBe(201);
    const tenantId = ((await created.json()) as { id: string }).id;
    const [person] = await handle.db
      .select({ id: principal.id })
      .from(principal)
      .where(and(eq(principal.tenantId, tenantId), eq(principal.kind, "user")));
    const scope = { tenantId, principalId: person!.id };
    await handle.db.execute(
      sql`insert into project (id, tenant_id, title) values (${tenantId}, ${tenantId}, 'Choice e2e')`,
    );
    const runId = randomUUID();
    await handle.db
      .insert(workflowDefinition)
      .values({ id: runId, tenantId, name: runId });
    await handle.db.insert(workflowRun).values({
      id: runId,
      definitionId: runId,
      anchorRunId: runId,
      tenantId,
      address: `${runId}@${tenantId}.test`,
      status: "running",
    });

    const artifactDb = handle.db as unknown as ArtifactDb;
    const option = async (concept: string) =>
      artifactDb.transaction((tx) =>
        createArtifact(tx, {
          scope,
          ownerPrincipalId: person!.id,
          kind: "design_option",
          title: concept,
          content: bundle(concept),
          source: { origin: "workflow" },
        }),
      );
    const harbour = await option("Harbour");
    await option("Meadow");
    const approve = async (concept: string) => {
      const id = randomUUID();
      await handle.db.insert(approval).values({
        id,
        tenantId,
        anchorRunId: runId,
        runId,
        agentAddress: `${runId}@${tenantId}.test`,
        correlationId: id,
        toolDefinition: { name: "choose_design" },
        toolArguments: { concept },
        status: "approved",
        scope: "once",
        resolvedAt: new Date(),
      });
      return id;
    };
    const choose = async (concept: string) => {
      const response = await call(
        `/api/tenants/${tenantId}/projects/${tenantId}/design-choice`,
        { concept },
        cookie,
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          code?: string;
          tool?: string;
          concept?: string;
          design?: { artifactId: string; version: number };
        },
      };
    };
    const recorded = async (approvalId: string) =>
      (
        await handle.db.execute<{ kind: string; version: number }>(
          sql`select kind, version from sb_artifact_approval where approval_id = ${approvalId} order by kind`,
        )
      ).map(({ kind, version }) => ({ kind, version }));

    const first = await approve("Harbour");
    const chosen = await choose("Harbour");
    expect(chosen.status).toBe(200);
    expect(chosen.body.concept).toBe("Harbour");
    expect(chosen.body.design?.version).toBe(1);
    expect(await recorded(first)).toEqual([
      { kind: "design", version: 1 },
      { kind: "design_option", version: 1 },
    ]);

    // The same approval never files a second design.
    const reused = await choose("Harbour");
    expect(reused).toEqual({
      status: 409,
      body: { code: "approval_already_used", tool: "choose_design" },
    });

    // An approval of one concept never files another.
    const wrong = await choose("Meadow");
    expect(wrong).toEqual({
      status: 409,
      body: { code: "approval_not_resolved", tool: "choose_design" },
    });

    // The person saves a look tweak while the card is open; the approval covers the concept, so
    // the tweaked option is what gets filed.
    const second = await approve("Harbour");
    await writeArtifactVersion(artifactDb, {
      scope,
      artifactId: harbour.id,
      content: bundle("Harbour, tweaked"),
    });
    const tweaked = await choose("Harbour");
    expect(tweaked.status).toBe(200);
    expect(tweaked.body.design?.version).toBe(2);
    expect(await recorded(second)).toEqual([
      { kind: "design", version: 2 },
      { kind: "design_option", version: 2 },
    ]);
    const filed = await getArtifactVersion(
      artifactDb,
      tweaked.body.design!.artifactId,
      2,
    );
    expect(filed?.content).toBe(bundle("Harbour, tweaked"));
  } finally {
    await runtime?.close();
    await handle.close();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
