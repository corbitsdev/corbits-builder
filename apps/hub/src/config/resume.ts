import type { ConversationTextTurn } from "@corbits-builder/schemas/conversation";
import type { ApprovalDecision } from "@intx/types/signals";
import { IMPORTED_PROJECT_LEAD } from "./import.ts";
import { SPECIALIST_ENDED_LEAD } from "./specialist-ended.ts";

// A resumed project's new coordinator starts with no history. The hub holds what it needs and
// delivers it with the person's next message, so its first turn answers that message.
const RESUME_CONTEXT_LEAD =
  "Background: this project's conversation continues from an earlier session. This is where it stood, not a new request.";
const RESUME_CONTEXT_END = "\n\nThe person's new message:\n\n";

// Hubs before the held resume context mailed this opening on the person's behalf.
const LEGACY_RESUME_OPENING = "I'm picking this project back up.";

// Sent by the hub, never shown to the person, when a coordinator on an outdated version was replaced
// as it started a writer: its writer did not start, and the person is not waiting to be asked.
const HANDOFF_LEAD =
  "Hub note, not from the person: Builder moved this project to a new version";
export const HANDOFF_OPENING = `${HANDOFF_LEAD} as you were starting a specialist, so it did not start. Check which documents are filed and approved, start the specialist the work needs next, and carry on without mentioning the move.`;
export const ASKING_HANDOFF_OPENING = `${HANDOFF_LEAD} as you were asking the person to approve something, so they never saw the question. Check which documents are filed and approved, ask for the approval the work needs next, and carry on without mentioning the move.`;

const TURN_CHARS = 2_000;
const CONTEXT_CHARS = 16_000;

const clip = (text: string) =>
  text.length > TURN_CHARS ? text.slice(0, TURN_CHARS) + " [clipped]" : text;

const turnLine = ({ role, text }: ConversationTextTurn): string => {
  if (role === "assistant") return "You: " + clip(text);
  if (text.startsWith(IMPORTED_PROJECT_LEAD))
    return "The project was imported from a file.";
  if (text.startsWith(SPECIALIST_ENDED_LEAD)) return clip(text);
  return "Person: " + clip(text);
};

/** The held context for a resumed coordinator, or undefined when there is nothing to carry. */
export function resumeContext(state: {
  turns: readonly ConversationTextTurn[];
  awaiting: readonly string[];
  withApp: boolean;
}): string | undefined {
  const lines: string[] = [];
  let size = 0;
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const line = turnLine(state.turns[index]!);
    size += line.length;
    if (size > CONTEXT_CHARS) break;
    lines.unshift(line);
  }
  const parts = [
    state.awaiting.length
      ? `Still waiting for the person's approval: ${state.awaiting.join(", ")}.`
      : "",
    state.withApp
      ? "The app is already built: its source is filed as the app document."
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

/** A person-sent turn without the held resume context, or undefined for a hub-written opening. */
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
  return message.startsWith(HANDOFF_LEAD) ? undefined : message;
}
