/**
 * The project conversation over native run mail.
 *
 * The committed event stream (`GET .../conversation/events`) is the
 * coordinator run's own projection, not a rendered transcript, and a send is
 * native run mail that returns Interchange's 202 acceptance receipt. The
 * thread renders `ChatMessage`, so `send` composes its receipt into that
 * shape.
 */
import type {
  ConversationEvents,
  QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../config.ts";
import { productClient } from "./transport.ts";
import {
  ApiFailure,
  type ChatMessage,
  type ConversationEvent,
} from "./types.ts";
import { workspaceTenantId } from "./auth.ts";

export type { ConversationEvent };

export type ConversationTurn =
  | { role: "person" | "assistant"; text: string; at: number }
  | { role: "participant"; sender: string; text: string; at: number };

/** Mail among the coordinator and workflow runs only, kept out of the person's chat. */
export type ConversationThread = {
  id: string;
  participants: string[];
  turns: ConversationTurn[];
};

/**
 * The committed conversation. `runId` is null while no coordinator is bound; the turns still
 * carry what the project's earlier coordinators said.
 */
export async function readConversationEvents(
  projectId: string,
): Promise<ConversationEvents> {
  return productClient().conversationEvents(
    await workspaceTenantId(),
    projectId,
  );
}

export type SendReceipt = { runId: string; address: string; messageId: string };

async function coordinatorRun(projectId: string) {
  const project = await productClient().project(
    await workspaceTenantId(),
    projectId,
  );
  if (project.coordinatorRunId === null)
    throw new ApiFailure(
      {
        code: "coordinator_unavailable",
        message: wording.conversation.noCoordinator,
        correlationId: "-",
        retryable: false,
      },
      409,
    );
  return { tenantId: project.tenantId, runId: project.coordinatorRunId };
}

/**
 * Sends one person message as native mail to the project's coordinator run
 * and composes the 202 receipt into the `ChatMessage` the thread renders:
 * Interchange minted the message id (the correlation id a later agent reply
 * names), the body is the person's own words, and `at` is this client's send
 * time — the receipt carries no per-message timestamp.
 */
export async function sendMessage(
  projectId: string,
  content: string,
): Promise<{
  receipt: SendReceipt;
  message: ChatMessage;
}> {
  const { tenantId, runId } = await coordinatorRun(projectId);
  const receipt = await productClient().sendMessage(tenantId, runId, {
    content,
  });
  return {
    receipt,
    message: {
      id: receipt.messageId,
      author: "me",
      body: content,
      at: new Date().toISOString(),
      triggerMessageId: receipt.messageId,
    },
  };
}

export function isInputPark(event: ConversationEvent): boolean {
  return event.type === "SignalAwaited" && event.body["parkKind"] === "input";
}

// --- The coordinator's questions ----------------------------------------------

/**
 * Answers the coordinator's open question through the hub, which saves and records what a screen's
 * answer does; the run takes it as the question call's result.
 */
export async function answerQuestion(
  projectId: string,
  signalName: string,
  answer: QuestionAnswer,
): Promise<void> {
  await productClient().answerQuestion(
    await workspaceTenantId(),
    projectId,
    signalName,
    answer,
  );
}
