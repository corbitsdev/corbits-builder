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
