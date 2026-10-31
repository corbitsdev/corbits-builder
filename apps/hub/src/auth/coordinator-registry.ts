import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import {
  createWorkflowRunLaunchSpecStore,
  workflowRunExecutability,
  type DB,
} from "@intx/db";
import { principal, workflowDefinition, workflowRun } from "@intx/db/schema";
import { digest } from "../lib/digest.ts";
import { version as coordinatorVersion } from "@corbits-builder/coordinator/package.json";
import { ProjectId } from "@corbits-builder/schemas/project";
import {
  project,
  projectCoordinator,
  mutationReceipt,
  outbox,
} from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";
import { grantBoundCoordinatorSpecialistAccess } from "./coordinator-run-grants.ts";
import { assertProjectProviderAllowed } from "../settings/policy.ts";
import { BindCoordinator } from "@corbits-builder/schemas/coordinator";
import type { Actor } from "../lib/actor.ts";

const CoordinatorStep = type({
  kind: "'step'",
  triggers: "'unbounded'",
  agent: {
    tags: { "coordinator.version": "string" },
    modelSources: type({ provider: "string > 0", model: "string > 0" })
      .array()
      .atLeastLength(1),
  },
});

// The host registers a real, approved unbounded coordinator. A name or a bearer
// claim cannot create that role; native grants remain a separate authority check.
export function createCoordinatorRegistry(db: DB["db"]) {
  const launches = createWorkflowRunLaunchSpecStore(db);
  return {
    async bind(actor: Actor, rawId: unknown, input: unknown) {
      const id = ProjectId(rawId);
      const body = BindCoordinator(input);
      if (id instanceof type.errors || body instanceof type.errors)
        throw new ProjectError(400, "invalid_coordinator_binding");
      const allowed = await reportAuthorization(db, actor);
      if (!(await allowed(projectResource(id), "manage")))
        throw new ProjectError(403, "forbidden");
      const scope = and(
        eq(mutationReceipt.tenantId, actor.tenantId),
        eq(mutationReceipt.actorPrincipalId, actor.principalId),
        eq(mutationReceipt.command, "bind_coordinator"),
        eq(mutationReceipt.idempotencyKey, body.idempotencyKey),
      );
      const payloadSha256 = digest({ projectId: id, ...body });
      return db.transaction(async (tx) => {
        const [actorRow] = await tx
          .select()
          .from(principal)
          .where(
            and(
              eq(principal.id, actor.principalId),
              eq(principal.tenantId, actor.tenantId),
              eq(principal.status, "active"),
              eq(principal.kind, "user"),
            ),
          );
        if (!actorRow)
          throw new ProjectError(403, "coordinator_registration_requires_user");
        const [parent] = await tx
          .select()
          .from(project)
          .where(and(eq(project.id, id), eq(project.tenantId, actor.tenantId)))
          .for("update");
        if (!parent) throw new ProjectError(404, "project_not_found");
        const [prior] = await tx.select().from(mutationReceipt).where(scope);
        if (prior) {
          if (prior.payloadSha256 !== payloadSha256)
            throw new ProjectError(409, "idempotency_key_reuse");
          await grantBoundCoordinatorSpecialistAccess(tx, {
            tenantId: actor.tenantId,
            projectId: id,
          });
          return prior.resultBody;
        }
        // The native run lock also serializes two projects claiming one run.
        const [run] = await tx
          .select()
          .from(workflowRun)
          .where(
            and(
              eq(workflowRun.id, body.runId),
              eq(workflowRun.tenantId, actor.tenantId),
            ),
          )
          .for("update");
        if (
          !run ||
          run.anchorRunId !== run.id ||
          !run.address ||
          workflowRunExecutability(run) !== "executable"
        )
          throw new ProjectError(409, "coordinator_run_unavailable");
        const definition = await tx.query.workflowDefinition.findFirst({
          where: and(
            eq(workflowDefinition.id, run.definitionId),
            eq(workflowDefinition.tenantId, actor.tenantId),
            eq(workflowDefinition.status, "deployed"),
          ),
        });
        if (
          !definition ||
          !(await allowed("workflow:" + definition.id, "read"))
        )
          throw new ProjectError(403, "forbidden");
        const launch = await launches.get(run.id, tx);
        const steps = launch
          ? Object.values(launch.frozenApprovalBundle.projection.steps)
          : [];
        const step = CoordinatorStep(steps[0]);
        if (
          !definition.wireHash ||
          steps.length !== 1 ||
          step instanceof type.errors ||
          step.agent.tags["coordinator.version"] !== coordinatorVersion
        )
          throw new ProjectError(409, "coordinator_definition_required");
        for (const source of step.agent.modelSources)
          await assertProjectProviderAllowed(
            tx,
            actor.tenantId,
            id,
            source.provider,
          );
        const [existing] = await tx
          .select()
          .from(projectCoordinator)
          .where(eq(projectCoordinator.runId, run.id));
        if (existing && existing.projectId !== id)
          throw new ProjectError(409, "coordinator_run_already_bound");
        await tx
          .update(projectCoordinator)
          .set({ active: false })
          .where(
            and(
              eq(projectCoordinator.projectId, id),
              eq(projectCoordinator.active, true),
            ),
          );
        await tx
          .insert(projectCoordinator)
          .values({
            runId: run.id,
            projectId: id,
            registeredBy: actor.principalId,
          })
          .onConflictDoUpdate({
            target: projectCoordinator.runId,
            set: { active: true },
          });
        const resultBody = JSON.stringify({ projectId: id, runId: run.id });
        const inserted = await tx
          .insert(mutationReceipt)
          .values({
            tenantId: actor.tenantId,
            actorPrincipalId: actor.principalId,
            command: "bind_coordinator",
            idempotencyKey: body.idempotencyKey,
            payloadSha256,
            resultBody,
          })
          .onConflictDoNothing()
          .returning({ key: mutationReceipt.idempotencyKey });
        if (!inserted.length)
          throw new ProjectError(409, "idempotency_key_reuse");
        await tx.insert(outbox).values({
          id: "ob_" + crypto.randomUUID(),
          projectId: id,
          eventType: "project.coordinator.bound",
          payload: { runId: run.id, actorPrincipalId: actor.principalId },
        });
        await grantBoundCoordinatorSpecialistAccess(tx, {
          tenantId: actor.tenantId,
          projectId: id,
        });
        return resultBody;
      });
    },
    async boundRun(runId: string) {
      const [row] = await db
        .select({
          projectId: projectCoordinator.projectId,
          run: workflowRun,
          definition: workflowDefinition,
        })
        .from(projectCoordinator)
        .innerJoin(project, eq(project.id, projectCoordinator.projectId))
        .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
        .innerJoin(
          workflowDefinition,
          eq(workflowDefinition.id, workflowRun.definitionId),
        )
        .where(
          and(
            eq(projectCoordinator.runId, runId),
            eq(projectCoordinator.active, true),
            eq(workflowRun.tenantId, project.tenantId),
            eq(workflowDefinition.tenantId, project.tenantId),
            eq(workflowDefinition.status, "deployed"),
          ),
        );
      return row &&
        row.run.anchorRunId === row.run.id &&
        row.run.address &&
        workflowRunExecutability(row.run) === "executable"
        ? row
        : null;
    },
  };
}
