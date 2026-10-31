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
 * The committed conversation, or null while the project has no bound
 * coordinator (the hub answers 409 `{ code: "coordinator_unavailable" }`).
 */
export async function readConversationEvents(projectId: string): Promise<{
  runId: string;
  events: ConversationEvent[];
  turns: ConversationTurn[];
  threads: ConversationThread[];
} | null> {
  const client = productClient();
  const tenantId = await workspaceTenantId();
  try {
    const body = await client.conversationEvents(tenantId, projectId);
    return {
      runId: body.runId,
      events: body.events,
      turns: body.turns ?? [],
      threads: body.threads ?? [],
    };
  } catch (cause) {
    const status =
      cause instanceof Error &&
      "response" in cause &&
      cause.response instanceof Response
        ? cause.response.status
        : undefined;
    if (status === 409) return null;
    throw cause;
  }
}

export type SendReceipt = { runId: string; address: string; messageId: string };

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
  const receipt = await client.sendMessage(
    project.tenantId,
    project.coordinatorRunId,
    { content },
  );
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
