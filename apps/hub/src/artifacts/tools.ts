import { WorkflowHttpError } from "@corbits-builder/tools-hub";
import { projectScopeFailure } from "../workflows/project-scope.ts";

export function failure(callId: string, error: unknown) {
  if (error instanceof WorkflowHttpError && error.status)
    return {
      callId,
      content: JSON.stringify({
        code: error.refusalCode ?? "artifact_api_refused",
        status: error.status,
        ...(error.issues?.length ? { issues: error.issues } : {}),
        ...(error.hint ? { hint: error.hint } : {}),
      }),
      isError: true,
    };
  return projectScopeFailure(callId, error);
}
