import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { WorkflowProjectScope } from "@corbits-builder/schemas/installed-workflows";
import { workflowHttpJson } from "./http-json.ts";

// A deployed agent keeps the bundle it started with; a field a newer hub adds must not refuse its scope.
const HubProjectScope = WorkflowProjectScope.onDeepUndeclaredKey("ignore");

export async function resolveWorkflowProjectScope(
  capabilities: RuntimeCapabilities,
  role: string,
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
