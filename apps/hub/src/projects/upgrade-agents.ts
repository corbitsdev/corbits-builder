import { and, desc, eq, inArray } from "drizzle-orm";
import { type } from "arktype";
import { createWorkflowRunDispatchStore, type DB } from "@intx/db";
import { approval, workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import {
  WORKFLOW_RUN_REF,
  workflowRunRepoIdForAddress,
  type WorkflowRunReader,
} from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import type { InstalledWorkflows } from "@corbits-builder/schemas/installed-workflows";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";
import { WORKFLOW_PACKAGES } from "../plugins/catalog.ts";
import { MODEL_CHOICE_REFUSALS } from "../config/models.ts";
import { SPECIALIST_OUTDATED } from "../config/agent-upgrade.ts";
import { HANDOFF_OPENING } from "../config/resume.ts";
import type { HubMail } from "../mail/hub-mail.ts";
import { project, projectCoordinator } from "../db/schema.ts";
import type { Actor } from "../lib/actor.ts";
import { settle } from "../lib/serial-queue.ts";
import { requestErrorMetadata } from "../request-error.ts";
import { ProjectError } from "./errors.ts";

const log = getLogger(["corbits-builder", "hub", "upgrade-agents"]);
const COORDINATOR_UPGRADED = "coordinator_upgraded";

// The packaged definition a run was frozen with; its version carries the bundle's content hash.
const FrozenDefinition = type({
  closure: {
    topLevel: type({ name: "string", version: "string" })
      .array()
      .exactlyLength(1),
  },
});

const pinOf = (bundle: unknown) => {
  const frozen = FrozenDefinition(bundle);
  if (frozen instanceof type.errors) return undefined;
  const [top] = frozen.closure.topLevel;
  return top && top.name + "@" + top.version;
};

/** The runs whose frozen package is not the one installed for their role, or has no readable pin. */
export function staleRuns<T extends { role: string; bundle: unknown }>(
  runs: readonly T[],
  installed: InstalledWorkflows,
): T[] {
  return runs.filter((run) => {
    const pin = pinOf(run.bundle);
    return (
      pin === undefined ||
      ![...WORKFLOW_PACKAGES].some(
        ([name, role]) =>
          role === run.role && installed.packages[name]?.pin === pin,
      )
    );
  });
}

/**
 * Moves a project's agents onto the installed packages once the project is quiet: every agent
 * waiting for input or not yet started, nothing on its way to it, and no approval pending. Interchange drops mail
 * to a stopping run, so nothing stops while anything could still be sent to it. Runs are cancelled
 * natively, so their history stays. An outdated coordinator is replaced at once and its specialists
 * stop with it; an outdated specialist alone stops, and starts again when the coordinator next
 * needs it.
 *
 * A project with no model choice to run on is left for the person: opening it upgrades as them, so
 * the refusal reaches them and their choice is the one the new coordinator runs on.
 */
export function createAgentUpgrades(deps: {
  db: DB["db"];
  runs: WorkflowRunReader;
  installed: (actor: Actor, projectId: string) => Promise<InstalledWorkflows>;
  startup: {
    ensure(actor: Actor, projectId: string): Promise<unknown>;
    release(actor: Actor, projectId: string): Promise<unknown>;
  };
  cancel: (tenantId: string, runId: string, reason: string) => Promise<unknown>;
  mail: HubMail;
}) {
  const { db } = deps;
  const dispatches = createWorkflowRunDispatchStore(db);

  // Mail or a signal the run has not yet taken.
  async function undelivered(runId: string) {
    return (await dispatches.listUnsettled(runId)).length > 0;
  }

  async function idle(run: { runId: string; address: string | null }) {
    if (!run.address) return false;
    const { events } = await deps.runs.readLatestRunEvents(
      workflowRunRepoIdForAddress(run.address),
      WORKFLOW_RUN_REF,
      (id) => id === run.runId,
    );
    // Every turn ends parked on input. A run with no events has never started, so nothing is in
    // progress and it is as safe to stop as one waiting.
    const latest = events.get(run.runId);
    const waiting =
      !latest ||
      (latest.type === "SignalAwaited" && latest.body["parkKind"] === "input");
    return waiting && !(await undelivered(run.runId));
  }

  async function allIdle(
    runs: readonly { runId: string; address: string | null }[],
  ) {
    for (const run of runs) if (!(await idle(run))) return false;
    return true;
  }

  // Only the agents' own asks count: one left by a run that has ended can never be decided.
  async function quiet(
    runs: readonly { runId: string; address: string | null }[],
  ) {
    const [asked] = await db
      .select({ id: approval.id })
      .from(approval)
      .where(
        and(
          inArray(
            approval.runId,
            runs.map((run) => run.runId),
          ),
          eq(approval.status, "pending"),
        ),
      )
      .limit(1);
    return !asked && (await allIdle(runs));
  }

  // The project's active coordinator, or its latest one when none is active, and its live
  // specialists (a project is its own tenant).
  async function agents(projectId: string, tenantId: string) {
    const [coordinator] = await db
      .select({
        runId: workflowRun.id,
        active: projectCoordinator.active,
        address: workflowRun.address,
        status: workflowRun.status,
        cancellationRequestedAt: workflowRun.cancellationRequestedAt,
        cancellationReason: workflowRun.cancellationReason,
        principalId: workflowRunLaunchSpec.sourceAuthorityPrincipalId,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
      })
      .from(projectCoordinator)
      .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .where(
        and(
          eq(projectCoordinator.projectId, projectId),
          eq(workflowRun.tenantId, tenantId),
        ),
      )
      .orderBy(
        desc(projectCoordinator.active),
        desc(projectCoordinator.createdAt),
      )
      .limit(1);
    const live = await db
      .select({
        runId: workflowRun.id,
        address: workflowRun.address,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
      })
      .from(workflowRun)
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .where(
        and(
          eq(workflowRun.tenantId, tenantId),
          inArray(workflowRun.status, ["deployed", "running"]),
        ),
      );
    const specialists = live.flatMap((run) => {
      const role = spawnedWorkflowRole(run.bundle);
      return role ? [{ ...run, role: role.name }] : [];
    });
    return {
      coordinator: coordinator && {
        ...coordinator,
        role: "coordinator" as const,
      },
      specialists,
    };
  }

  const running = (coordinator: {
    active: boolean;
    status: string;
    cancellationRequestedAt: Date | null;
  }) =>
    coordinator.active &&
    coordinator.cancellationRequestedAt === null &&
    ["deployed", "running"].includes(coordinator.status);

  // Specialists answer the coordinator that assigned them, so they stop with it.
  async function stopCoordinator(
    actor: Actor,
    projectId: string,
    coordinator: { runId: string },
    specialists: readonly { runId: string }[],
  ) {
    // Specialists first, so a stop cut short never leaves one running without its coordinator.
    const stopping = [...specialists, coordinator].map((run) => run.runId);
    await deps.startup.release(actor, projectId);
    for (const runId of stopping)
      await deps.cancel(actor.tenantId, runId, COORDINATOR_UPGRADED);
    log.info("Coordinator upgraded", { projectId, runIds: stopping });
  }

  async function upgrade(projectId: string, tenantId: string, opener?: Actor) {
    const { coordinator, specialists } = await agents(projectId, tenantId);
    if (!coordinator) return;
    const actor = opener ?? { tenantId, principalId: coordinator.principalId };
    // An upgrade that stopped the old coordinator but did not get its successor bound.
    if (!coordinator.active) {
      if (coordinator.cancellationReason === COORDINATOR_UPGRADED)
        await deps.startup.ensure(actor, projectId);
      return;
    }
    if (!running(coordinator)) return;
    const runs = [coordinator, ...specialists];
    const outdated = staleRuns(runs, await deps.installed(actor, projectId));
    if (outdated.length === 0 || !(await quiet(runs))) return;
    if (outdated.includes(coordinator)) {
      await stopCoordinator(actor, projectId, coordinator, specialists);
      await deps.startup.ensure(actor, projectId);
      return;
    }
    for (const run of outdated)
      await deps.cancel(tenantId, run.runId, SPECIALIST_OUTDATED);
    log.info("Outdated specialists stopped", {
      projectId,
      runIds: outdated.map((run) => run.runId),
    });
  }

  /**
   * Replaces an outdated coordinator the moment it starts a specialist, before the deploy lands; its
   * replacement is told at once, so the work carries on. Mid-turn the coordinator is never quiet, so
   * this waits only for its specialists and for any mail on its way to it.
   */
  async function handoff(
    projectId: string,
    tenantId: string,
    runId: string,
  ): Promise<"current" | "busy" | "handed_off"> {
    const { coordinator, specialists } = await agents(projectId, tenantId);
    if (coordinator?.runId !== runId || !running(coordinator))
      return "handed_off";
    const [parent] = await db
      .select({ status: project.status })
      .from(project)
      .where(eq(project.id, projectId));
    if (parent?.status !== "active") return "handed_off";
    const actor = { tenantId, principalId: coordinator.principalId };
    let installed: InstalledWorkflows;
    try {
      installed = await deps.installed(actor, projectId);
    } catch (error) {
      // The pass and the person's next open meet the same refusal; this deploy goes ahead.
      log.warn("Coordinator handoff check failed", {
        projectId,
        ...requestErrorMetadata(error),
      });
      return "current";
    }
    if (staleRuns([coordinator], installed).length === 0) return "current";
    if ((await undelivered(runId)) || !(await allIdle(specialists)))
      return "busy";
    await stopCoordinator(actor, projectId, coordinator, specialists);
    // The old run is stopping, so its deploy is held whatever happens next; the pass starts a
    // successor that failed to start here.
    try {
      await deps.startup.ensure(actor, projectId);
      const [next] = await db
        .select({ runId: projectCoordinator.runId })
        .from(projectCoordinator)
        .where(
          and(
            eq(projectCoordinator.projectId, projectId),
            eq(projectCoordinator.active, true),
          ),
        );
      if (next)
        await deps.mail({
          tenantId,
          runId: next.runId,
          principalId: actor.principalId,
          content: HANDOFF_OPENING,
        });
    } catch (error) {
      log.error("Coordinator handoff start failed", {
        projectId,
        ...requestErrorMetadata(error),
      });
    }
    return "handed_off";
  }

  // One upgrade per project at a time, so a pass, an open and a handoff never stop and start agents
  // at once. Each waits its turn and then runs as its own caller, so an opener meets their own
  // refusal.
  const inflight = new Map<string, Promise<unknown>>();
  function serialize<T>(projectId: string, work: () => Promise<T>) {
    const pending = inflight.get(projectId);
    async function afterPending() {
      try {
        await settle(pending);
        return await work();
      } finally {
        if (inflight.get(projectId) === current) inflight.delete(projectId);
      }
    }
    const current = afterPending();
    inflight.set(projectId, current);
    return current;
  }

  // The refusal each project last logged, so a project waiting on the person logs once, not every pass.
  const waiting = new Map<string, string>();
  async function reconcile(): Promise<boolean> {
    const active = await db
      .select({ projectId: project.id, tenantId: project.tenantId })
      .from(project)
      .where(eq(project.status, "active"));
    for (const { projectId, tenantId } of active) {
      try {
        await serialize(projectId, () => upgrade(projectId, tenantId));
        waiting.delete(projectId);
      } catch (error) {
        const code = error instanceof ProjectError ? error.code : undefined;
        if (code !== undefined && code in MODEL_CHOICE_REFUSALS) {
          if (waiting.get(projectId) === code) continue;
          waiting.set(projectId, code);
        }
        log.error("Agent upgrade failed", {
          projectId,
          ...(code === undefined ? {} : { code }),
          ...requestErrorMetadata(error),
        });
      }
    }
    return false;
  }

  // A specialist's deploy is never handed off.
  async function handoffOnce(tenantId: string, runId: string) {
    const [bound] = await db
      .select({ projectId: projectCoordinator.projectId })
      .from(projectCoordinator)
      .where(eq(projectCoordinator.runId, runId));
    if (!bound) return "current";
    const { projectId } = bound;
    return serialize(projectId, () => handoff(projectId, tenantId, runId));
  }

  return {
    reconcile,
    handoff: handoffOnce,
    open: (actor: Actor, projectId: string) =>
      serialize(projectId, () => upgrade(projectId, actor.tenantId, actor)),
  };
}
