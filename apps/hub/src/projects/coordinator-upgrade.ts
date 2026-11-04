import { and, desc, eq, inArray } from "drizzle-orm";
import { type } from "arktype";
import type { DB } from "@intx/db";
import {
  approval,
  workflowRun,
  workflowRunDispatch,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import {
  WORKFLOW_RUN_REF,
  workflowRunRepoIdForAddress,
  type WorkflowRunReader,
} from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import {
  roleDeployments,
  type InstalledWorkflows,
  type WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import type { ProjectUpdateReceipt } from "@corbits-builder/schemas/project";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";
import { MODEL_CHOICE_REFUSALS } from "../config/models.ts";
import { project, projectCoordinator } from "../db/schema.ts";
import type { Actor } from "../lib/actor.ts";
import { settle } from "../lib/serial-queue.ts";
import { requestErrorMetadata } from "../request-error.ts";
import { ProjectError } from "./errors.ts";

const log = getLogger(["corbits-builder", "hub", "coordinator-upgrade"]);
export const COORDINATOR_UPGRADED = "coordinator_upgraded";
// The person asked for the project's runs to move onto the current tool code.
export const PROJECT_UPDATED = "project_updated";
// A specialist replaced on its own, read by the coordinator that keeps running.
export const SPECIALIST_REPLACED =
  "project_updated: Builder was updated and this run was replaced; start it again to continue its work on the current version";

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

// The pins a role may run on: a coder is either coder package, by the project's package choice, and a
// writer any writer package, one per document kind.
const pinsFor = (installed: InstalledWorkflows, role: WorkflowRole) =>
  roleDeployments(installed, role).map((deployment) => deployment.pin);

/** The runs whose frozen package is not the one installed for their role, or has no readable pin. */
export function staleRuns<T extends { role: WorkflowRole; bundle: unknown }>(
  runs: readonly T[],
  installed: InstalledWorkflows,
): T[] {
  return runs.filter((run) => {
    const pin = pinOf(run.bundle);
    return pin === undefined || !pinsFor(installed, run.role).includes(pin);
  });
}

/**
 * Moves each project's coordinator onto the current coordinator definition at a safe point: parked on
 * the person's input with no unsettled inbound delivery, no pending approval and no specialist at work.
 * The old run is cancelled natively, so its history stays, and a fresh coordinator starts with no
 * turn of its own; the person's next message carries the held resume context to it.
 *
 * A project with no model choice to run on is left for the person: opening it upgrades as them, so
 * the refusal reaches them and their choice is the one the new coordinator runs on.
 */
export function createCoordinatorUpgrades(deps: {
  db: DB["db"];
  runs: WorkflowRunReader;
  installed: (actor: Actor, projectId: string) => Promise<InstalledWorkflows>;
  startup: {
    ensure(actor: Actor, projectId: string): Promise<unknown>;
    release(actor: Actor, projectId: string): Promise<unknown>;
  };
  cancel: (tenantId: string, runId: string, reason: string) => Promise<unknown>;
}) {
  const { db } = deps;

  async function parkedOnInput(run: { runId: string; address: string }) {
    const events = await deps.runs.readRunEvents(
      workflowRunRepoIdForAddress(run.address),
      WORKFLOW_RUN_REF,
      run.runId,
    );
    const last = events.findLast(
      (event) =>
        event.type === "SignalAwaited" || event.type === "SignalReceived",
    );
    return last?.type === "SignalAwaited" && last.body["parkKind"] === "input";
  }

  // The specialists to close with the coordinator, or undefined while one is still at work. A designer
  // or writer parked on input has filed its work and only waits for follow-up mail; a coder's
  // workspace holds unfiled progress, so any coder holds the upgrade back.
  // The tenant's live specialist runs with the role each was spawned as.
  async function liveSpecialists(tenantId: string) {
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
    return live.flatMap((run) => {
      const role = spawnedWorkflowRole(run.bundle);
      return role ? [{ ...run, role }] : [];
    });
  }

  async function settledSpecialists(tenantId: string) {
    const parked: string[] = [];
    for (const run of await liveSpecialists(tenantId)) {
      if (run.role === "coder" || !run.address) return undefined;
      if (!(await parkedOnInput({ runId: run.runId, address: run.address })))
        return undefined;
      parked.push(run.runId);
    }
    return parked;
  }

  // Parked on the person's input with every delivery to it settled.
  async function coordinatorIdle(run: { runId: string; address: string }) {
    if (!(await parkedOnInput(run))) return false;
    const [delivery] = await db
      .select({ id: workflowRunDispatch.id })
      .from(workflowRunDispatch)
      .where(
        and(
          eq(workflowRunDispatch.anchorRunId, run.runId),
          inArray(workflowRunDispatch.status, ["pending", "acknowledged"]),
        ),
      )
      .limit(1);
    return delivery === undefined;
  }

  async function approvalPending(tenantId: string) {
    const [asked] = await db
      .select({ id: approval.id })
      .from(approval)
      .where(
        and(eq(approval.tenantId, tenantId), eq(approval.status, "pending")),
      )
      .limit(1);
    return asked !== undefined;
  }

  async function atSafePoint(
    actor: Actor,
    run: { runId: string; address: string },
  ) {
    if (!(await coordinatorIdle(run))) return undefined;
    if (await approvalPending(actor.tenantId)) return undefined;
    return settledSpecialists(actor.tenantId);
  }

  async function start(actor: Actor, projectId: string) {
    await deps.startup.ensure(actor, projectId);
    const [bound] = await db
      .select({ runId: projectCoordinator.runId })
      .from(projectCoordinator)
      .where(
        and(
          eq(projectCoordinator.projectId, projectId),
          eq(projectCoordinator.active, true),
        ),
      );
    if (!bound) return;
    log.info("Coordinator upgraded", { projectId, runId: bound.runId });
  }

  // The project's active coordinator, or the latest one when none is active.
  async function latestCoordinator(projectId: string, tenantId: string) {
    const [latest] = await db
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
    return latest;
  }

  // A replacement that cancelled the old run but did not get its successor bound finishes with the
  // next pass or open.
  const replaced = (reason: string | null) =>
    reason === COORDINATOR_UPGRADED || reason === PROJECT_UPDATED;

  async function upgrade(projectId: string, tenantId: string, opener?: Actor) {
    const latest = await latestCoordinator(projectId, tenantId);
    if (!latest) return;
    const actor = opener ?? { tenantId, principalId: latest.principalId };
    if (!latest.active) {
      if (replaced(latest.cancellationReason)) await start(actor, projectId);
      return;
    }
    if (
      !latest.address ||
      latest.cancellationRequestedAt !== null ||
      !["deployed", "running"].includes(latest.status)
    )
      return;
    const current = (await deps.installed(actor, projectId)).coordinator.pin;
    if (pinOf(latest.bundle) === current) return;
    const parked = await atSafePoint(actor, {
      runId: latest.runId,
      address: latest.address,
    });
    if (!parked) return;
    await deps.startup.release(actor, projectId);
    for (const runId of parked)
      await deps.cancel(tenantId, runId, COORDINATOR_UPGRADED);
    await deps.cancel(tenantId, latest.runId, COORDINATOR_UPGRADED);
    await start(actor, projectId);
  }

  /**
   * Moves the project's runs onto the current tool code when the person asks: the specialists whose
   * frozen package is behind the installed one are cancelled, and the coordinator with every parked
   * specialist when it is the one behind, so a fresh coordinator starts as an upgrade does. Unlike
   * the pass, a parked coder is replaced too; its unfiled work is what the person gives up. A run
   * mid-turn is left alone and named, so nothing is cut off.
   */
  async function update(
    actor: Actor,
    projectId: string,
  ): Promise<ProjectUpdateReceipt> {
    const latest = await latestCoordinator(projectId, actor.tenantId);
    if (!latest) return { updated: false, reason: "no_coordinator" };
    if (!latest.active) {
      if (!replaced(latest.cancellationReason))
        return { updated: false, reason: "no_coordinator" };
      await start(actor, projectId);
      return { updated: true };
    }
    if (
      !latest.address ||
      latest.cancellationRequestedAt !== null ||
      !["deployed", "running"].includes(latest.status)
    )
      return { updated: false, reason: "no_coordinator" };
    const installed = await deps.installed(actor, projectId);
    const specialists = await liveSpecialists(actor.tenantId);
    const coordinatorStale =
      staleRuns([{ role: "coordinator", bundle: latest.bundle }], installed)
        .length > 0;
    const stale = staleRuns(specialists, installed);
    if (!coordinatorStale && stale.length === 0)
      return { updated: false, reason: "current" };
    const coordinator = { runId: latest.runId, address: latest.address };
    if (!(await coordinatorIdle(coordinator)))
      return { updated: false, reason: "coordinator_busy" };
    if (await approvalPending(actor.tenantId))
      return { updated: false, reason: "approval_pending" };
    for (const run of specialists)
      if (
        !run.address ||
        !(await parkedOnInput({ runId: run.runId, address: run.address }))
      )
        return { updated: false, reason: "specialist_working" };
    if (!coordinatorStale) {
      for (const run of stale)
        await deps.cancel(actor.tenantId, run.runId, SPECIALIST_REPLACED);
      log.info("Project updated: specialists replaced", {
        projectId,
        runIds: stale.map((run) => run.runId),
      });
      return { updated: true };
    }
    await deps.startup.release(actor, projectId);
    for (const run of specialists)
      await deps.cancel(actor.tenantId, run.runId, PROJECT_UPDATED);
    await deps.cancel(actor.tenantId, latest.runId, PROJECT_UPDATED);
    await start(actor, projectId);
    return { updated: true };
  }

  // One upgrade per project at a time, so a pass and an open never both cancel and start. An open
  // runs as its opener, so it waits out a pass rather than sharing the pass's starter.
  const inflight = new Map<
    string,
    { opened: boolean; work: Promise<unknown> }
  >();
  function upgradeOnce(projectId: string, tenantId: string, opener?: Actor) {
    const pending = inflight.get(projectId);
    if (pending && (pending.opened || !opener)) return settle(pending.work);
    async function upgradeAfterPending(): Promise<void> {
      try {
        await settle(pending?.work);
        await upgrade(projectId, tenantId, opener);
      } finally {
        if (inflight.get(projectId)?.work === work) inflight.delete(projectId);
      }
    }
    const work = upgradeAfterPending();
    inflight.set(projectId, { opened: opener !== undefined, work });
    return work;
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
        await upgradeOnce(projectId, tenantId);
        waiting.delete(projectId);
      } catch (error) {
        const code = error instanceof ProjectError ? error.code : undefined;
        if (code !== undefined && code in MODEL_CHOICE_REFUSALS) {
          if (waiting.get(projectId) === code) continue;
          waiting.set(projectId, code);
        }
        log.error("Coordinator upgrade failed", {
          projectId,
          ...(code === undefined ? {} : { code }),
          ...requestErrorMetadata(error),
        });
      }
    }
    return false;
  }

  // An update waits out a pass or an open on the project, and holds the next one back.
  function updateOnce(actor: Actor, projectId: string) {
    const pending = inflight.get(projectId);
    async function updateAfterPending(): Promise<ProjectUpdateReceipt> {
      try {
        await settle(pending?.work);
        return await update(actor, projectId);
      } finally {
        if (inflight.get(projectId)?.work === work) inflight.delete(projectId);
      }
    }
    const work = updateAfterPending();
    inflight.set(projectId, { opened: true, work });
    return work;
  }

  return {
    reconcile,
    open: (actor: Actor, projectId: string) =>
      upgradeOnce(projectId, actor.tenantId, actor),
    update: updateOnce,
  };
}
