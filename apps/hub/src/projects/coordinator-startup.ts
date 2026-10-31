import { and, eq } from "drizzle-orm";
import {
  SidecarReuseRejectedError,
  workflowRunExecutability,
  type DB,
} from "@intx/db";
import { sidecarAllocation, tenant, workflowRun } from "@intx/db/schema";
import {
  WorkflowProvisioningError,
  type AssetService,
} from "@intx/hub-sessions";
import type { InstalledWorkflows } from "@corbits-builder/schemas/installed-workflows";
import type { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { createCoordinatorRegistry } from "../auth/coordinator-registry.ts";
import { COORDINATOR_CAPACITY_FULL } from "../config/coordinator-start.ts";
import {
  installForTenant,
  startFailed,
} from "../workflows/install-for-tenant.ts";
import { projectCoordinator } from "../db/schema.ts";
import { ProjectError } from "./errors.ts";
import type { Actor } from "../lib/actor.ts";

const START_FAILED = "coordinator_start_failed";
const READY_WAIT_MS = 120_000;
const READY_POLL_MS = 250;

type BoundRun = { runId: string; ended: boolean };

type CoordinatorStartupPorts = {
  installed(actor: Actor, projectId: string): Promise<InstalledWorkflows>;
  boundRun(tenantId: string, projectId: string): Promise<BoundRun | null>;
  unbind(tenantId: string, projectId: string): Promise<BoundRun | null>;
  deploy(args: {
    tenantId: string;
    principalId: string;
    deployment: NativeSpecialistDeployment;
  }): Promise<{ runId: string }>;
  awaitReady(args: { tenantId: string; runId: string }): Promise<void>;
  bind(
    actor: Actor,
    projectId: string,
    body: { runId: string; idempotencyKey: string },
  ): Promise<unknown>;
};

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

// A dead hub's coding-host markers are cleared at startup. If that proof is
// still missing, the create call stays one plain error instead of a generic 500,
// and a later create or open can finish startup.
function plainCoordinatorStartupError(
  error: unknown,
): ProjectError | undefined {
  if (error instanceof ProjectError) return undefined;
  if (
    errorChain(error).some((item) => item instanceof SidecarReuseRejectedError)
  )
    return new ProjectError(409, "coordinator_capacity_full", {
      message: COORDINATOR_CAPACITY_FULL,
    });
  if (error instanceof WorkflowProvisioningError)
    return new ProjectError(409, error.code, { message: error.message });
  if (
    errorChain(error).some(
      (item) => item.message === "local_host_cleanup_unproven",
    )
  )
    return startFailed();
  if (
    error instanceof Error &&
    error.message.length > 0 &&
    error.message.length < 500
  )
    return new ProjectError(409, START_FAILED, { message: error.message });
  return startFailed();
}

function startKey(tenantId: string, projectId: string): string {
  return tenantId + "\n" + projectId;
}

function bindingKey(projectId: string, runId: string): string {
  return (
    "coord-" +
    new Bun.CryptoHasher("sha256")
      .update(projectId + "\n" + runId)
      .digest("hex")
      .slice(0, 48)
  );
}

// Startup runs in the project's own tenant: the workflow packages install there
// and the coordinator deploys as a principal of it. A project whose coordinator
// is live is left alone; one whose coordinator ended (lifetime expiry, failure)
// is unbound and gets a fresh run. A deploy that already minted a run is bound
// again instead of deploying a second coordinator. Resolves true when it bound
// a new run.
function createProjectCoordinatorStartup(ports: CoordinatorStartupPorts) {
  const inflight = new Map<string, Promise<boolean>>();
  const deployed = new Map<string, string>();
  return {
    ensure(actor: Actor, projectId: string): Promise<boolean> {
      const key = startKey(actor.tenantId, projectId);
      const pending = inflight.get(key);
      if (pending) return pending;
      async function attachOnce() {
        try {
          return await attach(ports, deployed, key, actor, projectId);
        } finally {
          inflight.delete(key);
        }
      }
      const work = attachOnce();
      inflight.set(key, work);
      return work;
    },
    // Forgets the binding and the cached deploy so a later ensure starts a fresh
    // run; the caller stops the returned run.
    async release(actor: Actor, projectId: string): Promise<BoundRun | null> {
      deployed.delete(startKey(actor.tenantId, projectId));
      return ports.unbind(actor.tenantId, projectId);
    },
    async attached(actor: Actor, projectId: string): Promise<boolean> {
      const row = await ports.boundRun(actor.tenantId, projectId);
      return row !== null && !row.ended;
    },
  };
}

async function attach(
  ports: CoordinatorStartupPorts,
  deployed: Map<string, string>,
  key: string,
  actor: Actor,
  projectId: string,
): Promise<boolean> {
  const existing = await ports.boundRun(actor.tenantId, projectId);
  if (existing && !existing.ended) {
    await ports.awaitReady({ tenantId: actor.tenantId, runId: existing.runId });
    return false;
  }
  if (existing) {
    deployed.delete(key);
    await ports.unbind(actor.tenantId, projectId);
  }
  let runId = deployed.get(key);
  if (!runId) {
    let created: { runId: string };
    try {
      const installed = await ports.installed(actor, projectId);
      created = await ports.deploy({
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        deployment: installed.coordinator,
      });
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw plainCoordinatorStartupError(error) ?? startFailed();
    }
    runId = created.runId;
    deployed.set(key, runId);
  }
  await ports.awaitReady({ tenantId: actor.tenantId, runId });
  try {
    await ports.bind(actor, projectId, {
      runId,
      idempotencyKey: bindingKey(projectId, runId),
    });
  } catch (error) {
    if (
      error instanceof ProjectError &&
      error.code === "coordinator_definition_required"
    )
      throw startFailed();
    throw error;
  }
  return true;
}

async function awaitCoordinatorReady(
  db: DB["db"],
  tenantId: string,
  runId: string,
): Promise<void> {
  const deadline = Date.now() + READY_WAIT_MS;
  for (;;) {
    const [run] = await db
      .select()
      .from(workflowRun)
      .where(
        and(eq(workflowRun.id, runId), eq(workflowRun.tenantId, tenantId)),
      );
    const [allocation] = await db
      .select({
        status: sidecarAllocation.status,
        nextAttemptAt: sidecarAllocation.nextAttemptAt,
      })
      .from(sidecarAllocation)
      .where(eq(sidecarAllocation.anchorRunId, runId));
    const executable =
      run !== undefined &&
      run.anchorRunId === run.id &&
      Boolean(run.address) &&
      workflowRunExecutability(run) === "executable";
    const allocationReady =
      allocation === undefined ||
      (allocation.status === "allocated" && allocation.nextAttemptAt === null);
    const allocationFailed =
      allocation !== undefined &&
      (allocation.status === "failed" ||
        allocation.status === "released" ||
        allocation.status === "releasing" ||
        allocation.status === "destroy_failed");
    if (executable && allocationReady) return;
    if (
      allocationFailed ||
      (run && workflowRunExecutability(run) === "terminal")
    )
      throw startFailed();
    if (Date.now() >= deadline) throw startFailed();
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

export function createInstalledCoordinatorStartup(
  db: DB["db"],
  assets: Pick<
    AssetService,
    "createAsset" | "populateAsset" | "readAssetBlob" | "listAssetBlobs"
  >,
  allocate: (args: {
    tenantId: string;
    principalId: string;
    domain: string;
    deployment: NativeSpecialistDeployment;
  }) => Promise<{ runId: string }>,
) {
  const registry = createCoordinatorRegistry(db);
  return createProjectCoordinatorStartup({
    installed(actor, projectId) {
      return installForTenant({ db, assets }, actor, projectId);
    },
    async boundRun(tenantId, projectId) {
      const [row] = await db
        .select({
          runId: projectCoordinator.runId,
          status: workflowRun.status,
          expiresAt: workflowRun.expiresAt,
          cancellationRequestedAt: workflowRun.cancellationRequestedAt,
        })
        .from(projectCoordinator)
        .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
        .where(
          and(
            eq(projectCoordinator.projectId, projectId),
            eq(projectCoordinator.active, true),
            eq(workflowRun.tenantId, tenantId),
          ),
        );
      return row
        ? {
            runId: row.runId,
            ended: workflowRunExecutability(row) !== "executable",
          }
        : null;
    },
    async unbind(tenantId, projectId) {
      const row = await this.boundRun(tenantId, projectId);
      if (!row) return null;
      await db
        .update(projectCoordinator)
        .set({ active: false })
        .where(eq(projectCoordinator.runId, row.runId));
      return row;
    },
    async deploy(args) {
      const [row] = await db
        .select({ domain: tenant.domain })
        .from(tenant)
        .where(eq(tenant.id, args.tenantId));
      if (!row?.domain) throw startFailed();
      try {
        return await allocate({ ...args, domain: row.domain });
      } catch (error) {
        const plain = plainCoordinatorStartupError(error);
        if (plain) throw plain;
        throw error;
      }
    },
    awaitReady(args) {
      return awaitCoordinatorReady(db, args.tenantId, args.runId);
    },
    bind(actor, projectId, body) {
      return registry.bind(actor, projectId, body);
    },
  });
}
