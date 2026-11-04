import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  WorkflowProjectScope,
  type InstalledWorkflows,
  type WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import { WorkflowHttpError, workflowHttpJson } from "./http-json.ts";

const log = getLogger(["corbits-builder", "hub", "workflow-project-scope"]);
const SAFE_CODE = /^[a-z0-9_:]+$/;
// A deployed agent keeps the bundle it started with; a field a newer hub adds must not refuse its scope.
const HubProjectScope = WorkflowProjectScope.onDeepUndeclaredKey("ignore");

/** The packages a run of the role may deploy or read, the coder resolved for the project. */
export function scopeWorkflows(
  installed: InstalledWorkflows,
  role: WorkflowRole,
  installsAnyPackage: boolean,
): WorkflowProjectScope["workflows"] {
  return {
    "writer-constraints": installed["writer-constraints"],
    "writer-approaches": installed["writer-approaches"],
    "writer-product-requirements": installed["writer-product-requirements"],
    "writer-build-plan": installed["writer-build-plan"],
    // A bundle frozen before writers were split requires writer to read its scope. Only a
    // coordinator deploys from it, and an old one would start the constraints writer for any
    // kind, so a coordinator goes without until it is upgraded.
    ...(role === "coordinator"
      ? {}
      : { writer: installed["writer-constraints"] }),
    reviewer: installed.reviewer,
    coder: installsAnyPackage
      ? installed["coder-any-package"]
      : installed.coder,
    designer: installed.designer,
    presenter: installed.presenter,
  };
}

// The model sees only the original code (never a refusal body or arbitrary message); the cause stays in the hub log.
export function projectScopeFailure(callId: string, error: unknown) {
  log.error(
    "Workflow project scope or tool call failed",
    requestErrorMetadata(error),
  );
  const code =
    error instanceof WorkflowHttpError && error.refusalCode
      ? error.refusalCode
      : error instanceof Error && SAFE_CODE.test(error.message)
        ? error.message
        : "workflow_project_scope_unavailable";
  return { callId, content: code, isError: true };
}

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
