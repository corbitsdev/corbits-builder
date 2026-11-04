import { type } from "arktype";

// These are the native mail request/acceptance and committed-event wire shapes.
// No client-side principal, target run or trigger identity is accepted.
export type ConversationMessage = Readonly<{
  content: string;
  attachments?: ReadonlyArray<
    Readonly<{ mimeType: string; data: string; name?: string }>
  >;
}>;

/**
 * A person's words as mail delivers them and the conversation reads them back: LF line breaks, no
 * spaces or tabs at the end of a line, trimmed.
 */
export const deliveredText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(withoutTrailingBlanks)
    .join("\n")
    .trim();

// A scan from the end, since a regex for trailing blanks backtracks quadratically on a long run.
function withoutTrailingBlanks(line: string) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
  return line.slice(0, end);
}

export const maxTurnText = 20000;

export function clippedTurnText(text: string) {
  const clipped = text.slice(0, maxTurnText);
  // A cut between the halves of a surrogate pair would leave half a character.
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

export const ConversationReceipt = type({
  runId: "string",
  address: "string",
  messageId: "string",
});
export type ConversationReceipt = typeof ConversationReceipt.infer;
const turnText = type("string > 0").atMostLength(maxTurnText);
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
/** The hub's refusal of a deploy from a coordinator it is replacing; the replacement redoes it. */
export const coordinatorUpgrading = "coordinator_upgrading";
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
  runId: "string | null",
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
