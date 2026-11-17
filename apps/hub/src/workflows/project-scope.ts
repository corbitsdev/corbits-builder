import type {
  InstalledWorkflows,
  WorkflowProjectScope,
} from "@corbits-builder/schemas/installed-workflows";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";
import {
  accessRefusal,
  WorkflowHttpError,
} from "@corbits-builder/plugin/http-json";

const log = getLogger(["corbits-builder", "hub", "workflow-project-scope"]);
const SAFE_CODE = /^[a-z0-9_:]+$/;

/** The packages any run in the project may deploy: every installed one but the coordinator's. */
export function scopeWorkflows(
  installed: InstalledWorkflows,
): WorkflowProjectScope["workflows"] {
  return Object.fromEntries(
    Object.entries(installed.packages).filter(
      ([name]) => name !== "coordinator",
    ),
  );
}

// The model sees the hub's refusal or the original code, never an arbitrary message; the cause stays in the hub log.
export function projectScopeFailure(callId: string, error: unknown) {
  log.error(
    "Workflow project scope or tool call failed",
    requestErrorMetadata(error),
  );
  const code =
    error instanceof WorkflowHttpError ||
    (error instanceof Error && SAFE_CODE.test(error.message))
      ? error.message
      : "workflow_project_scope_unavailable";
  return { callId, content: code, isError: true, ...accessRefusal(error) };
}

// A hub call the hub refused, as the tool's error result: the refusal's code, or refusedCode when the
// hub named none.
export function toolFailure(
  callId: string,
  error: unknown,
  refusedCode: string,
) {
  if (error instanceof WorkflowHttpError && error.status)
    return {
      callId,
      content: JSON.stringify({
        code: error.refusalCode ?? refusedCode,
        status: error.status,
        ...(error.issues.length ? { issues: error.issues } : {}),
        ...(error.hint ? { hint: error.hint } : {}),
      }),
      isError: true,
      ...accessRefusal(error),
    };
  return projectScopeFailure(callId, error);
}
