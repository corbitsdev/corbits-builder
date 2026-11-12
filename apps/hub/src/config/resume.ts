import type {
  ConversationTextTurn,
  ParkedQuestion,
} from "@corbits-builder/schemas/conversation";
import type { ApprovalDecision } from "@intx/types/signals";
import { IMPORTED_PROJECT_LEAD } from "./import.ts";
import {
  PLUGIN_HINT_END,
  PLUGIN_HINT_LEAD,
} from "@corbits-builder/plugin-host/text";

// A resumed project's new coordinator starts with no history. The hub holds what it needs and
// delivers it with the person's next message, so its first turn answers that message.
const RESUME_CONTEXT_LEAD =
  "Background: this project's conversation continues from an earlier session. This is where it stood, not a new request.";
const RESUME_CONTEXT_END = "\n\nThe person's new message:\n\n";

// Hubs before the held resume context mailed this opening on the person's behalf.
const LEGACY_RESUME_OPENING = "I'm picking this project back up.";

// Every note the hub mails a run on the person's behalf starts with this, so neither the coordinator
// nor the conversation takes it for words the person wrote. A note the person sees has its plain
// line first and the coordinator's detail after a blank line, as the conversation shows only the line.
export const HUB_NOTE_LEAD = "Hub note, not from the person: ";

// Sent by the hub, never shown to the person, when a coordinator on an outdated version was replaced
// as it started a writer: its writer did not start, and the person is not waiting to be asked.
const HANDOFF_LEAD = `${HUB_NOTE_LEAD}Builder moved this project to a new version`;
export const HANDOFF_OPENING = `${HANDOFF_LEAD} as you were starting a specialist, so it did not start. Check what the project holds and where its plan stands, start what the work needs next, and carry on without mentioning the move.`;

const TURN_CHARS = 2_000;
const CONTEXT_CHARS = 16_000;

const clip = (text: string) =>
  text.length > TURN_CHARS ? text.slice(0, TURN_CHARS) + " [clipped]" : text;

const turnLine = ({ role, text }: ConversationTextTurn): string => {
  if (role === "assistant") return "You: " + clip(text);
  if (text.startsWith(IMPORTED_PROJECT_LEAD))
    return "The project was imported from a file.";
  if (text.startsWith(HUB_NOTE_LEAD)) return clip(text);
  return "Person: " + clip(text);
};

// The coordinator's text replies never hold its questions: they and the person's answers live only
// in the run log, so they are stated here or a resumed coordinator re-decides what was settled.
function questionLine({ asked, answer }: ParkedQuestion): string {
  if ("plugin" in asked) {
    const screen =
      asked.action === undefined
        ? asked.plugin
        : `${asked.plugin} ${asked.action}`;
    const opened = `You opened the ${screen} screen for the person.`;
    if (answer === undefined)
      return `${opened} It is still open: open it again rather than assume what they chose.`;
    if ("reply" in answer)
      return clip(`${opened} The person replied instead: ${answer.reply}`);
    return clip(
      `${opened} The screen sent back: ${JSON.stringify("output" in answer ? answer.output : answer.answers)}`,
    );
  }
  const prompts = asked.questions.map(({ question }) => question).join(" / ");
  if (answer === undefined)
    return clip(
      `You asked: ${prompts} / Still open: ask it again rather than assume an answer.`,
    );
  if ("reply" in answer)
    return clip(
      `You asked: ${prompts} / Person replied instead: ${answer.reply}`,
    );
  if ("output" in answer)
    return clip(
      `You asked: ${prompts} / Person answered: ${JSON.stringify(answer.output)}`,
    );
  const { answers } = answer;
  return clip(
    asked.questions
      .map(
        ({ id, question }) =>
          `You asked: ${question} / Person answered: ${answers[id]?.join(", ") || "nothing"}`,
      )
      .join("\n"),
  );
}

/** The held context for a resumed coordinator, or undefined when there is nothing to carry. */
export function resumeContext(state: {
  turns: readonly ConversationTextTurn[];
  questions: readonly ParkedQuestion[];
  awaiting: readonly string[];
  withApp: boolean;
}): string | undefined {
  const said = [
    ...state.turns.map((turn) => ({ at: turn.at, line: turnLine(turn) })),
    ...state.questions.map((question) => ({
      at: question.at,
      line: questionLine(question),
    })),
  ].sort((left, right) => left.at - right.at);
  const lines: string[] = [];
  let size = 0;
  for (let index = said.length - 1; index >= 0; index -= 1) {
    const { line } = said[index]!;
    size += line.length;
    if (size > CONTEXT_CHARS) break;
    lines.unshift(line);
  }
  const parts = [
    state.awaiting.length
      ? `Still waiting for the person's approval: ${state.awaiting.join(", ")}.`
      : "",
    state.withApp
      ? "The project's code is already built and filed as the app document; a change to it can be made directly."
      : "",
    lines.length
      ? "Earlier conversation, oldest first:\n\n" + lines.join("\n\n")
      : "",
  ].filter(Boolean);
  return parts.length
    ? [RESUME_CONTEXT_LEAD, ...parts].join("\n\n")
    : undefined;
}

export const resumeMessage = (context: string | undefined, message: string) =>
  context === undefined ? message : context + RESUME_CONTEXT_END + message;

/** The person's approval decision as a resumed coordinator reads it. */
export function approvalDecisionLine({
  outcome,
  message,
}: ApprovalDecision): string {
  const decided = outcome === "approved" ? "Approved" : "Rejected";
  // A blank note is no note: the line ends at the decision, not at a dangling colon.
  const note = message?.trim();
  if (note === undefined || note === "") return `${decided} a request.`;
  return `${decided} a request: ${note}`;
}

/** A person-sent turn without the held resume context or plugin hint, or undefined for a hub-written opening. */
export function withoutResumeContext(text: string): string | undefined {
  if (text.startsWith(LEGACY_RESUME_OPENING)) return undefined;
  let message = text;
  if (text.startsWith(RESUME_CONTEXT_LEAD)) {
    const end = text.indexOf(RESUME_CONTEXT_END);
    // Delivered text is trimmed, so a blank new message leaves the marker without its blank line.
    if (end === -1)
      return text.endsWith(RESUME_CONTEXT_END.trimEnd()) ? "" : text;
    message = text.slice(end + RESUME_CONTEXT_END.length);
  }
  const hint = message.lastIndexOf(PLUGIN_HINT_LEAD);
  if (hint !== -1 && message.endsWith(PLUGIN_HINT_END))
    message = message.slice(0, hint);
  return message.startsWith(HANDOFF_LEAD) ? undefined : message;
}
