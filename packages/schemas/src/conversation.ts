import { type } from "arktype";

// These are the native mail request/acceptance and committed-event wire shapes.
// No client-side principal, target run or trigger identity is accepted.
export type ConversationMessage = Readonly<{
  content: string;
  attachments?: ReadonlyArray<
    Readonly<{ mimeType: string; data: string; name?: string }>
  >;
}>;
export const ConversationReceipt = type({
  runId: "string",
  address: "string",
  messageId: "string",
});
export type ConversationReceipt = typeof ConversationReceipt.infer;
const turnText = type("string > 0").atMostLength(20000);
// A participant turn is mail from a workflow run other than the coordinator;
// `sender` names its role or run.
const conversationTextTurn = type({
  role: "'person' | 'assistant'",
  text: turnText,
  at: "number",
}).or({
  role: "'participant'",
  sender: "string > 0",
  text: turnText,
  at: "number",
});
export const maxConversationTurns = 2000;
const turnList = conversationTextTurn
  .array()
  .atMostLength(maxConversationTurns);
// A mail thread between the coordinator and workflow runs only, keyed by its
// References root. Threads that include a person are folded into `turns`.
const conversationThread = type({
  id: "string > 0",
  participants: type("string > 0").array(),
  turns: turnList,
});
export const ConversationEvents = type({
  runId: "string",
  events: type({
    seq: "number",
    type: "string",
    body: "Record<string, unknown>",
  }).array(),
  "turns?": turnList,
  "threads?": conversationThread.array(),
});
export type ConversationEvents = typeof ConversationEvents.infer;
export type ConversationTextTurn = typeof conversationTextTurn.infer;
export type ConversationThread = typeof conversationThread.infer;
