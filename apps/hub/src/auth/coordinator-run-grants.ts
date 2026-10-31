import { and, eq, inArray, notInArray } from "drizzle-orm";
import { workflowRunExecutability, type DBExecutor } from "@intx/db";
import {
  grant,
  principal,
  workflowRun,
  workflowRunLaunchSpec,
} from "@intx/db/schema";
import { projectCoordinator } from "../db/schema.ts";

// A coordinator bound after a specialist's deploy reads that run through an exact
// `workflow-run:<id>` read grant (`manage` would also let it stop the run) and, before
// launch, becomes the invoker of record, so mail admission and invoker delegation follow
// the active binding.
type CoordinatorSpecialistRun = {
  runId: string;
  sourceAuthorityPrincipalId: string;
  launched: boolean;
};

export type CoordinatorRunGrant = {
  id: string;
  principalId: string;
  resource: string;
  action: "read";
  effect: "allow";
  origin: "system";
};

function coordinatorRunReadGrantId(principalId: string, runId: string): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(principalId + "\n" + runId + "\nread")
    .digest("hex")
    .slice(0, 40);
  return "coord-read-" + digest;
}

export function planCoordinatorSpecialistGrants(args: {
  coordinatorPrincipalId: string;
  specialists: readonly CoordinatorSpecialistRun[];
}): { grants: CoordinatorRunGrant[]; retargetRunIds: string[] } {
  const grants: CoordinatorRunGrant[] = [];
  const retargetRunIds: string[] = [];
  for (const specialist of args.specialists) {
    grants.push({
      id: coordinatorRunReadGrantId(
        args.coordinatorPrincipalId,
        specialist.runId,
      ),
      principalId: args.coordinatorPrincipalId,
      resource: "workflow-run:" + specialist.runId,
      action: "read",
      effect: "allow",
      origin: "system",
    });
    if (
      !specialist.launched &&
      specialist.sourceAuthorityPrincipalId !== args.coordinatorPrincipalId
    )
      retargetRunIds.push(specialist.runId);
  }
  return { grants, retargetRunIds };
}

export async function grantBoundCoordinatorSpecialistAccess(
  tx: DBExecutor,
  args: { tenantId: string; projectId: string },
): Promise<{ grants: CoordinatorRunGrant[]; retargetRunIds: string[] }> {
  const [active] = await tx
    .select({
      principalId: workflowRun.principalId,
    })
    .from(projectCoordinator)
    .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
    .innerJoin(principal, eq(principal.id, workflowRun.principalId))
    .where(
      and(
        eq(projectCoordinator.projectId, args.projectId),
        eq(projectCoordinator.active, true),
        eq(workflowRun.tenantId, args.tenantId),
        eq(workflowRun.anchorRunId, workflowRun.id),
        eq(principal.tenantId, args.tenantId),
        eq(principal.kind, "workflow"),
        eq(principal.status, "active"),
        eq(principal.refId, projectCoordinator.runId),
      ),
    );
  if (!active?.principalId) return { grants: [], retargetRunIds: [] };
  const coordinators = await tx
    .select({
      runId: projectCoordinator.runId,
      principalId: workflowRun.principalId,
    })
    .from(projectCoordinator)
    .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
    .where(
      and(
        eq(projectCoordinator.projectId, args.projectId),
        eq(workflowRun.tenantId, args.tenantId),
      ),
    );
  const principalIds = [
    ...new Set(
      coordinators.flatMap((row) => (row.principalId ? [row.principalId] : [])),
    ),
  ];
  const coordinatorRunIds = coordinators.map((row) => row.runId);
  if (!principalIds.length || !coordinatorRunIds.length)
    return { grants: [], retargetRunIds: [] };
  const rows = await tx
    .select({
      id: workflowRun.id,
      status: workflowRun.status,
      expiresAt: workflowRun.expiresAt,
      cancellationRequestedAt: workflowRun.cancellationRequestedAt,
      principalId: workflowRun.principalId,
      sourceAuthorityPrincipalId:
        workflowRunLaunchSpec.sourceAuthorityPrincipalId,
    })
    .from(workflowRun)
    .innerJoin(
      workflowRunLaunchSpec,
      eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
    )
    .where(
      and(
        eq(workflowRun.tenantId, args.tenantId),
        eq(workflowRun.anchorRunId, workflowRun.id),
        inArray(workflowRunLaunchSpec.sourceAuthorityPrincipalId, principalIds),
        notInArray(workflowRun.id, coordinatorRunIds),
      ),
    );
  const plan = planCoordinatorSpecialistGrants({
    coordinatorPrincipalId: active.principalId,
    specialists: rows.flatMap((row) =>
      workflowRunExecutability(row) === "executable"
        ? [
            {
              runId: row.id,
              sourceAuthorityPrincipalId: row.sourceAuthorityPrincipalId,
              launched: row.principalId !== null,
            },
          ]
        : [],
    ),
  });
  if (plan.grants.length) {
    await tx
      .insert(grant)
      .values(
        plan.grants.map((row) => ({
          id: row.id,
          tenantId: args.tenantId,
          principalId: row.principalId,
          resource: row.resource,
          action: row.action,
          effect: row.effect,
          origin: row.origin,
        })),
      )
      .onConflictDoNothing();
  }
  for (const runId of plan.retargetRunIds) {
    await tx
      .update(workflowRunLaunchSpec)
      .set({ sourceAuthorityPrincipalId: active.principalId })
      .where(
        and(
          eq(workflowRunLaunchSpec.anchorRunId, runId),
          notInArray(workflowRunLaunchSpec.sourceAuthorityPrincipalId, [
            active.principalId,
          ]),
        ),
      );
  }
  return plan;
}
