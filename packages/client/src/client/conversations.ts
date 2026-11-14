import { ConversationReceipt } from "@corbits-builder/schemas/conversation";
import {
  ProductApiError,
  projectPath,
  tenantPath,
  type ClientDeps,
  type ProductApiClient,
} from "./shared";

export function buildConversationMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  "sendMessage" | "conversationEvents" | "answerQuestion"
> {
  const { request, baseUrl, headers, fetchRequest, options } = deps;
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
    // The run's own signal channel for the question. Once the run has an answer, any later one is
    // refused.
    async answerQuestion(
      projectTenantId,
      coordinatorRunId,
      signalName,
      answer,
      signal,
    ) {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Content-Type", "application/json");
      const response = await fetchRequest(
        new Request(
          new URL(
            `${tenantPath(projectTenantId)}/workflows/${encodeURIComponent(coordinatorRunId)}/signals`,
            baseUrl,
          ).href,
          {
            method: "POST",
            headers: requestHeaders,
            cache: "no-store",
            credentials: options.credentials ?? "same-origin",
            body: JSON.stringify({
              runId: coordinatorRunId,
              signalName,
              signalId: signalName,
              payload: answer,
            }),
            ...(signal ? { signal } : {}),
          },
        ),
      );
      if (!response.ok) throw new ProductApiError(response);
    },
    conversationEvents(tenantId, projectId, signal) {
      return request(
        `${projectPath(tenantId, projectId)}/conversation/events`,
        signal,
      );
    },
  };
}
