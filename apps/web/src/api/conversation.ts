/**
 * The project conversation over native run mail.
 *
 * The committed event stream (`GET .../conversation/events`) is the
 * coordinator run's own projection, not a rendered transcript, and a send is
 * native run mail that returns Interchange's 202 acceptance receipt. The
 * thread renders `ChatMessage`, so `send` composes its receipt into that
 * shape and `events` derives the latest person-input question (an input park
 * and its releasing signal) from the events.
 */
import type { ConversationEvents } from "@corbits-builder/schemas/conversation";
import type { QuestionAnswer } from "@intx/types/signals";
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
  const client = productClient();
  const project = await client.project(await workspaceTenantId(), projectId);
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
  return {
    client,
    tenantId: project.tenantId,
    runId: project.coordinatorRunId,
  };
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
  const { client, tenantId, runId } = await coordinatorRun(projectId);
  const receipt = await client.sendMessage(tenantId, runId, { content });
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

// --- The input-park question fold ---------------------------------------------

export type QuestionState = "pending" | "answered" | "input-received";

export type PendingQuestion = {
  park: ConversationEvent;
  received?: ConversationEvent;
  state: QuestionState;
  answeredByYou: boolean;
  correlationId?: string;
};

const RUN_ENDS = new Set(["RunCompleted", "RunFailed", "RunCancelled"]);

/** A coordinator run that ended answers nothing more, so its open question waits on no one. */
export function runEnded(events: readonly ConversationEvent[]): boolean {
  return events.some((event) => RUN_ENDS.has(event.type));
}

export function isInputPark(event: ConversationEvent): boolean {
  return event.type === "SignalAwaited" && event.body["parkKind"] === "input";
}

/** The asking prose the hub's projection attached to the park, when it provided one. */
export function parkProse(
  park: ConversationEvent,
): { prose: string; source?: { kind: string; agentKey?: string } } | undefined {
  if (!isInputPark(park)) return undefined;
  const question = park.body["question"];
  if (typeof question !== "object" || question === null) return undefined;
  const record = question as { prose?: unknown; source?: unknown };
  if (typeof record.prose !== "string" || record.prose.trim() === "")
    return undefined;
  const source =
    typeof record.source === "object" && record.source !== null
      ? (record.source as { kind?: unknown; agentKey?: unknown })
      : undefined;
  return {
    prose: record.prose,
    ...(source && typeof source.kind === "string"
      ? {
          source: {
            kind: source.kind,
            ...(typeof source.agentKey === "string"
              ? { agentKey: source.agentKey }
              : {}),
          },
        }
      : {}),
  };
}

function receivedCorrelationId(event: ConversationEvent): string | undefined {
  if (event.type !== "SignalReceived") return undefined;
  const payload = event.body["payload"] as
    | { headers?: { messageId?: unknown } }
    | undefined;
  const messageId = payload?.headers?.messageId;
  return typeof messageId === "string" ? messageId : undefined;
}

/**
 * The latest question to the person: the last input park plus whichever
 * committed signal released it. Correlation comes only from accepted 202
 * message ids.
 */
export function latestQuestion(
  events: ConversationEvent[],
  yourAnswerMessageIds: readonly string[],
): PendingQuestion | undefined {
  const park = [...events].reverse().find(isInputPark);
  if (park === undefined) return undefined;
  const received = events
    .filter((event) => event.seq > park.seq)
    .sort((a, b) => a.seq - b.seq)
    .find((event) => event.type === "SignalReceived");
  if (received === undefined)
    return { park, state: "pending", answeredByYou: false };
  const correlationId = receivedCorrelationId(received);
  const answeredByYou =
    correlationId !== undefined && yourAnswerMessageIds.includes(correlationId);
  return {
    park,
    received,
    state: answeredByYou ? "answered" : "input-received",
    answeredByYou,
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}

// --- The coordinator's questions ----------------------------------------------

/** Answers the coordinator's open question; the run takes it as the question call's result. */
export async function answerQuestion(
  projectId: string,
  signalName: string,
  answer: QuestionAnswer,
): Promise<void> {
  const { client, tenantId, runId } = await coordinatorRun(projectId);
  await client.answerQuestion(tenantId, runId, signalName, answer);
}
