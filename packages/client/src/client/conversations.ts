import { ConversationReceipt } from "@corbits-builder/schemas/conversation";
import {
  projectPath,
  tenantPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

export function buildConversationMethods(
  deps: ClientDeps,
): Pick<ProductApiClient, "sendMessage" | "conversationEvents"> {
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
    conversationEvents(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/conversation/events`,
        signal,
      );
    },
  };
}
