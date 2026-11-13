import { ConversationReceipt } from "@corbits-builder/schemas/conversation";
import {
  projectPath,
  tenantPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

export function buildConversationMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  "sendMessage" | "conversationEvents" | "runSteps" | "answerQuestion"
> {
  const { request } = deps;
  return {
    async sendMessage(projectTenantId, coordinatorRunId, message, signal) {
      return ConversationReceipt.assert(
        await request(
          `${tenantPath(projectTenantId)}/workflows/runs/${encodeURIComponent(coordinatorRunId)}/mail`,
          signal,
          message,
        ),
      );
    },
    // The hub checks and records what a screen's answer does, then delivers it to the run. Once
    // the run has an answer, any later one is refused.
    async answerQuestion(tenantId, projectId, signalName, answer, signal) {
      await request(`${projectPath(tenantId, projectId)}/answers`, signal, {
        signalName,
        answer,
      });
    },
    conversationEvents(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/conversation/events`,
        signal,
      );
    },
    runSteps(tenantId, runId, signal) {
      return request(
        `${tenantPath(tenantId)}/workflows/runs/${encodeURIComponent(runId)}/steps`,
        signal,
      );
    },
  };
}
