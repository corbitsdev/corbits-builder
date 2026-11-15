import { eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import { project } from "../db/schema.ts";
import { workflowRoleSql } from "../workflows/spawn-role.ts";
import { workflowBindings } from "../config/models.ts";
import { modelDirectory } from "../settings/custom-providers.ts";
import { loadSettings } from "../settings/policy.ts";
import type { RunSpanAgent } from "../telemetry/run-spans.ts";

export async function runTelemetry(
  db: DB["db"],
  runId: string,
): Promise<Pick<RunSpanAgent, "tenantId" | "projectId" | "role" | "effort">> {
  const [run] = await db
    .select({
      projectId: project.id,
      tenantId: workflowRun.tenantId,
      role: workflowRoleSql(workflowRunLaunchSpec.frozenApprovalBundle),
    })
    .from(workflowRun)
    .leftJoin(project, eq(project.tenantId, workflowRun.tenantId))
    .leftJoin(
      workflowRunLaunchSpec,
      eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
    )
    .where(eq(workflowRun.id, runId));
  const metadata: Pick<
    RunSpanAgent,
    "tenantId" | "projectId" | "role" | "effort"
  > = {};
  if (!run) return metadata;
  metadata.tenantId = run.tenantId;
  if (run.role !== null) metadata.role = run.role;
  if (run.projectId === null) return metadata;
  metadata.projectId = run.projectId;
  const { models } = await loadSettings(db, run.tenantId, run.projectId);
  if (run.role !== null && models.value !== null) {
    const bindings = workflowBindings(
      await modelDirectory(db, run.tenantId),
      models.value,
    );
    metadata.effort = bindings[run.role].effort;
  }
  return metadata;
}
