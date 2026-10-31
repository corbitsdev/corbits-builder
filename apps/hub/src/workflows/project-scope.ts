import { getLogger } from "@intx/log";
import { projectScopeCode } from "@corbits-builder/tools-hub";
import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "workflow-project-scope"]);

export function projectScopeFailure(callId: string, error: unknown) {
  log.error(
    "Workflow project scope or tool call failed",
    requestErrorMetadata(error),
  );
  return { callId, content: projectScopeCode(error), isError: true };
}
