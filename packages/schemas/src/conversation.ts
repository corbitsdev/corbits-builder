import { type } from "arktype";
import { AskedQuestion } from "@intx/types/runtime-core";
import { QuestionAnswer } from "@intx/types/signals";

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
/** A question the coordinator paused on, from its wait in the run log, with the answer once one arrived. */
const parkedQuestion = type({
  at: "number",
  signalName: "string",
  asked: AskedQuestion,
  "answer?": QuestionAnswer,
});
export type ParkedQuestion = typeof parkedQuestion.infer;
export const ConversationEvents = type({
  runId: "string | null",
  events: type({
    seq: "number",
    type: "string",
    body: "Record<string, unknown>",
  }).array(),
  "turns?": turnList,
  "threads?": conversationThread.array(),
  // The project's earlier coordinator runs' questions; `events` holds only the live run's.
  "earlierQuestions?": parkedQuestion.array(),
});
export type ConversationEvents = typeof ConversationEvents.infer;
export type ConversationTextTurn = typeof conversationTextTurn.infer;
export type ConversationThread = typeof conversationThread.infer;

/**
 * Every question the coordinator asked in a run, oldest first, from its committed events. A question
 * whose stored wording does not parse is left out; an answer that does not parse leaves its question
 * unanswered. The agent received the first signal on a name, so a later one never replaces it.
 */
export function parkedQuestions(
  events: ConversationEvents["events"],
): ParkedQuestion[] {
  const questions: ParkedQuestion[] = [];
  const received = new Set<string>();
  for (const { type: kind, body } of events) {
    const signalName = body["signalName"];
    if (typeof signalName !== "string") continue;
    if (kind === "SignalAwaited" && body["parkKind"] === "question") {
      const asked = AskedQuestion(body["question"]);
      if (!(asked instanceof type.errors))
        questions.push({
          at: Date.parse(String(body["at"])),
          signalName,
          asked,
        });
    }
    if (kind !== "SignalReceived" || received.has(signalName)) continue;
    received.add(signalName);
    const parked = questions.find((item) => item.signalName === signalName);
    const answer = QuestionAnswer(body["payload"]);
    if (parked !== undefined && !(answer instanceof type.errors))
      parked.answer = answer;
  }
  return questions;
}
