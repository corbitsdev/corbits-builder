import { type } from "arktype";
import { eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import { project } from "../db/schema.ts";
import { workflowRoleSql } from "../workflows/spawn-role.ts";
import { workflowBindings } from "../config/models.ts";
import { ROLES } from "../plugins/catalog.ts";
import { modelDirectory } from "../settings/custom-providers.ts";
import { loadSettings } from "../settings/policy.ts";
import type { RunContext } from "../telemetry/run-spans.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";

const FrozenPackage = type({
  closure: {
    topLevel: type({ name: "string", version: "string" })
      .array()
      .exactlyLength(1),
  },
});

export function runPackageVersion(bundle: unknown): string | undefined {
  const frozen = FrozenPackage(bundle);
  if (frozen instanceof type.errors) return undefined;
  return frozen.closure.topLevel[0]?.version;
}

const log = getLogger(["corbits-builder", "telemetry"]);

export async function runTelemetry(
  db: DB["db"],
  runId: string,
): Promise<RunContext> {
  const [run] = await db
    .select({
      projectId: project.id,
      tenantId: workflowRun.tenantId,
      role: workflowRoleSql(workflowRunLaunchSpec.frozenApprovalBundle),
      bundle: workflowRunLaunchSpec.frozenApprovalBundle,
    })
    .from(workflowRun)
    .leftJoin(project, eq(project.tenantId, workflowRun.tenantId))
    .leftJoin(
      workflowRunLaunchSpec,
      eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
    )
    .where(eq(workflowRun.id, runId));
  const metadata: RunContext = {};
  if (!run) return metadata;
  metadata.tenantId = run.tenantId;
  metadata.packageVersion = runPackageVersion(run.bundle);
  if (run.role !== null) metadata.role = run.role;
  if (run.projectId === null) return metadata;
  metadata.projectId = run.projectId;
  if (run.role === null) return metadata;
  // A profile that cannot run has no effort to report; the run is still traced with what is known.
  try {
    const { models } = await loadSettings(db, run.tenantId, run.projectId);
    if (models.value !== null) {
      metadata.profile = models.value.profile;
      metadata.effort = workflowBindings(
        await modelDirectory(db, run.tenantId),
        models.value,
        ROLES,
      )[run.role].effort;
    }
  } catch (error) {
    log.warn("Run effort could not be read", requestErrorMetadata(error));
  }
  return metadata;
}
