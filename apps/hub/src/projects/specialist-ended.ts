import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import type { WorkflowRunReader } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { decodeMail } from "@intx/mime";
import { listMail } from "@intx/storage-isogit/node";
import { runFailure } from "../artifacts/service.ts";
import { specialistEndedMessage } from "../config/specialist-ended.ts";
import { endedRun, project, projectCoordinator } from "../db/schema.ts";
import type { HubMail } from "../mail/hub-mail.ts";
import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";

const log = getLogger(["corbits-builder", "hub", "specialist-ended"]);

// The correlation id of the latest assignment the run received after its last outgoing mail; none
// when it answered every assignment it was given.
async function unansweredAssignment(
  mailDirectory: string,
  runId: string,
): Promise<string | undefined> {
  let assigned: { at: number; correlationId: string } | undefined;
  let answeredAt = -Infinity;
  try {
    for (const entry of await listMail(join(mailDirectory, runId))) {
      const { headers } = decodeMail(entry.raw);
      if (headers.date === undefined) continue;
      const at = Date.parse(headers.date);
      if (!Number.isFinite(at)) continue;
      const correlationId = headers.interchangeCorrelationId;
      if (entry.direction === "out") answeredAt = Math.max(answeredAt, at);
      else if (correlationId !== undefined && (!assigned || at >= assigned.at))
        assigned = { at, correlationId };
    }
  } catch (error) {
    // Unreadable mail reads as answered, so the ended run is still recorded.
    log.warn("Reading ended specialist {runId}'s mail failed", {
      runId,
      ...errorCode(error),
      ...requestErrorMetadata(error),
    });
    return undefined;
  }
  return assigned && assigned.at > answeredAt
    ? assigned.correlationId
    : undefined;
}

/** A tenant's specialist runs that still hold a sidecar slot. */
export async function liveSpecialistRuns(
  db: DB["db"],
  tenantId: string,
): Promise<string[]> {
  const live = await db
    .select({
      runId: workflowRun.id,
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
  return live
    .filter((run) => spawnedWorkflowRole(run.bundle))
    .map((run) => run.runId);
}

/**
 * Mails a project's coordinator once when one of its specialists ends failed or cancelled with an
 * assignment it never answered. The terminal status is read from the run row on the native scheduler
 * whose reconcilers write it.
 */
export function createSpecialistEndNotices(deps: {
  db: DB["db"];
  runs: WorkflowRunReader;
  mailDirectory: string;
  mail: HubMail;
}) {
  const { db } = deps;
  return async function reconcileNext(): Promise<boolean> {
    const [ended] = await db
      .select({
        runId: workflowRun.id,
        status: workflowRun.status,
        address: workflowRun.address,
        failureCode: workflowRun.failureCode,
        failureMessage: workflowRun.failureMessage,
        cancellationReason: workflowRun.cancellationReason,
        projectId: project.id,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
      })
      .from(workflowRun)
      .innerJoin(project, eq(project.tenantId, workflowRun.tenantId))
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .leftJoin(endedRun, eq(endedRun.runId, workflowRun.id))
      .where(
        and(
          inArray(workflowRun.status, ["failed", "cancelled"]),
          isNull(endedRun.runId),
        ),
      )
      .orderBy(workflowRun.endedAt)
      .limit(1);
    if (!ended) return false;
    const record = (notified: boolean) =>
      db
        .insert(endedRun)
        .values({ runId: ended.runId, projectId: ended.projectId, notified })
        .onConflictDoNothing()
        .returning({ runId: endedRun.runId });
    const role = spawnedWorkflowRole(ended.bundle);
    const correlationId = role
      ? await unansweredAssignment(deps.mailDirectory, ended.runId)
      : undefined;
    const [coordinator] =
      correlationId === undefined
        ? []
        : await db
            .select({
              runId: projectCoordinator.runId,
              tenantId: workflowRun.tenantId,
              principalId: workflowRunLaunchSpec.sourceAuthorityPrincipalId,
            })
            .from(projectCoordinator)
            .innerJoin(
              workflowRun,
              eq(workflowRun.id, projectCoordinator.runId),
            )
            .innerJoin(
              workflowRunLaunchSpec,
              eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
            )
            .where(
              and(
                eq(projectCoordinator.projectId, ended.projectId),
                eq(projectCoordinator.active, true),
              ),
            );
    // The hub cancels unpicked concept designers itself after the person's pick; nothing is lost.
    const unpicked = ended.cancellationReason === "design_concept_not_picked";
    if (!role || correlationId === undefined || !coordinator || unpicked) {
      await record(false);
      return true;
    }
    if ((await record(true)).length === 0) return true;
    // A writer's or reviewer's assignment is correlated as `<role>-<kind>-<runId>` by deploy_writer
    // and review_artifact.
    const prefix = role + "-";
    const suffix = "-" + ended.runId;
    const kind =
      correlationId.startsWith(prefix) && correlationId.endsWith(suffix)
        ? correlationId.slice(prefix.length, -suffix.length) || undefined
        : undefined;
    const failure =
      ended.status === "failed"
        ? await runFailure(deps.runs, ended)
        : undefined;
    const reason =
      failure ??
      (ended.cancellationReason === null
        ? undefined
        : { message: ended.cancellationReason });
    try {
      await deps.mail({
        tenantId: coordinator.tenantId,
        runId: coordinator.runId,
        principalId: coordinator.principalId,
        content: specialistEndedMessage({
          role,
          ...(kind ? { kind } : {}),
          status: ended.status === "failed" ? "failed" : "cancelled",
          ...(reason ? { reason } : {}),
        }),
      });
    } catch (error) {
      log.error("Specialist end notice not delivered", {
        runId: ended.runId,
        coordinatorRunId: coordinator.runId,
        ...requestErrorMetadata(error),
      });
      // A failed notice is final; settling it keeps it from holding back the next.
      await db
        .update(endedRun)
        .set({ notified: false })
        .where(eq(endedRun.runId, ended.runId));
    }
    return true;
  };
}
