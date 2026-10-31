import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  WorkflowProjectScope,
  type WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import { WorkflowHttpError, workflowHttpJson } from "./http-json.ts";

// A deployed agent keeps the bundle it started with; a field a newer hub adds must not refuse its scope.
const HubProjectScope = WorkflowProjectScope.onDeepUndeclaredKey("ignore");

export async function resolveWorkflowProjectScope(
  capabilities: RuntimeCapabilities,
  role: WorkflowRole,
  signal: AbortSignal,
) {
  const scope = HubProjectScope.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: "/api/workflow-project-scope",
      maxResponseBytes: 16384,
      signal,
    }),
  );
  if (scope.role !== role) throw new Error("workflow_project_role_refused");
  return scope;
}

const SAFE_CODE = /^[a-z0-9_:]+$/;

// The model sees only the original code (never a refusal body or arbitrary message); the cause stays in the hub log.
export function projectScopeCode(error: unknown): string {
  if (error instanceof WorkflowHttpError && error.refusalCode)
    return error.refusalCode;
  if (error instanceof Error && SAFE_CODE.test(error.message))
    return error.message;
  return "workflow_project_scope_unavailable";
}
