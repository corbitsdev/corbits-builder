import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { createDB } from "@intx/db";
import {
  principal,
  workflowDefinition,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import { workflowRunRepoIdForAddress } from "@intx/hub-sessions";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { migrateDatabase } from "@corbits-builder/hub/migrate";
import { createTestDatabase, signUpSessionCookie } from "./hub.ts";

const origin = "http://127.0.0.1:1";

/**
 * The real hub in process, never served or started, so the runs a test seeds stay as seeded, with
 * a signed-up person who calls it. None of the runs has a workspace on the local sidecar's disk
 * unless a test puts one there.
 */
export async function startInProcessHub() {
  const database = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), "sb-in-process-"));
  const dataDir = join(directory, "hub");
  const environment: Record<string, string> = {
    ...database.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    // Never bound: requests go straight to the app.
    PORT: "1",
    BETTER_AUTH_BASE_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PRINCIPAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HUB_DATA_DIR: dataDir,
  };
  const handle = createDB(database.connection);
  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  const close = async () => {
    await runtime?.close();
    await handle.close();
    await database.drop();
    await rm(directory, { recursive: true, force: true });
  };
  let cookie: string;
  try {
    await migrateDatabase(environment);
    runtime = await createHubRuntime(environment);
    const app = runtime.app;
    cookie = await signUpSessionCookie(
      (request) => app.fetch(request),
      origin,
      `e2e-${randomUUID()}@example.invalid`,
      randomBytes(16).toString("hex"),
      "In-process e2e",
    );
  } catch (error) {
    await close();
    throw error;
  }
  const { app } = runtime;

  // The response, or the error naming its status and body; the person's session unless the
  // credentials say otherwise.
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: object,
    credentials: Record<string, string> = { cookie },
  ) {
    const response = await app.fetch(
      new Request(`${origin}${path}`, {
        method,
        headers: { origin, "content-type": "application/json", ...credentials },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    if (!response.ok)
      throw new Error(
        `HTTP ${String(response.status)}: ${await response.text()}`,
      );
    return response;
  }

  return {
    dataDir,
    db: handle.db,
    call,
    json: async <T>(response: Promise<Response>) =>
      (await (await response).json()) as T,

    // A project in a tenant of its own, which the person created and so manages.
    async seedProject(title: string) {
      const projectId = `p-${randomUUID().replaceAll("-", "")}`;
      const created = await call("POST", "/api/tenants", {
        name: projectId,
        slug: projectId,
      });
      const { id: tenantId } = (await created.json()) as { id: string };
      await handle.db.execute(
        sql`insert into project (id, tenant_id, title) values (${projectId}, ${tenantId}, ${title})`,
      );
      const [person] = await handle.db
        .select({ id: principal.id })
        .from(principal)
        .where(
          and(eq(principal.tenantId, tenantId), eq(principal.kind, "user")),
        );
      return {
        projectId,
        person: { tenantId, principalId: person!.id },
        path: `/api/tenants/${tenantId}/projects/${projectId}`,
      };
    },

    // A run of the role in the project under its own workflow principal, deployed by the person:
    // ended a minute ago or, with running, still running, and where the local sidecar keeps its
    // workspace.
    async seedRun(
      person: { tenantId: string; principalId: string },
      role: "designer" | "coder",
      running = false,
    ) {
      const id = randomUUID();
      const principalId = randomUUID();
      const address = `${id}@${person.tenantId}.test`;
      await handle.db.insert(principal).values({
        id: principalId,
        tenantId: person.tenantId,
        kind: "workflow",
        refId: id,
        status: "active",
      });
      await handle.db
        .insert(workflowDefinition)
        .values({ id, tenantId: person.tenantId, name: id });
      await handle.db.insert(workflowRun).values({
        id,
        definitionId: id,
        anchorRunId: id,
        tenantId: person.tenantId,
        principalId,
        address,
        ...(running
          ? { status: "running" as const }
          : {
              status: "cancelled" as const,
              cancellationReason: "stopped",
              endedAt: new Date(Date.now() - 60_000),
            }),
      });
      await handle.db.insert(workflowRunLaunchSpec).values({
        anchorRunId: id,
        sessionId: id,
        deploymentDomain: `${person.tenantId}.test`,
        sourceAuthorityPrincipalId: person.principalId,
        frozenApprovalBundle: {
          projection: {
            steps: { work: { agent: { tags: { [`${role}.version`]: "1" } } } },
          },
        },
        sourceOfferingIds: [],
        defaultSourceOfferingId: "offering",
      });
      return {
        id,
        principalId,
        workspace: join(
          dataDir,
          "local-sidecars",
          "sidecar",
          "workflow-step-state",
          workflowRunRepoIdForAddress(address).id,
          "warm",
          "work",
          "workspace",
        ),
      };
    },

    close,
  };
}
