import { productClient } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";

export async function readProjectActivity(
  projectId: string,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().projectActivity(tenantId, projectId, signal);
}

export async function readDecidedApprovals(
  projectId: string,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().decidedApprovals(tenantId, projectId, signal);
}

export async function readProjectNextStep(
  projectId: string,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().projectNextStep(tenantId, projectId, signal);
}

export async function readProjectRunStates(
  projectId: string,
  signal?: AbortSignal,
) {
  const tenantId = await workspaceTenantId();
  return productClient().projectRunStates(tenantId, projectId, signal);
}

/** Every call a run made so far, from its saved conversation. */
export function readRunSteps(
  tenantId: string,
  runId: string,
  signal?: AbortSignal,
) {
  return productClient().runSteps(tenantId, runId, signal);
}

/** Stops a specialist run the coordinator started in the project, as the person. */
export async function stopRun(projectId: string, runId: string) {
  const tenantId = await workspaceTenantId();
  return productClient().stopRun(tenantId, projectId, runId);
}
