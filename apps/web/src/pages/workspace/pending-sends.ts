import type { ConversationPart } from "@corbits/react-ui";
import {
  clippedTurnText,
  deliveredText,
} from "@corbits-builder/schemas/conversation";
import type { ConversationTurn } from "../../api/conversation.ts";
import type { ChatMessage } from "../../api/types.ts";
import type { TranscriptTurn } from "./transcript.tsx";

// A message's stand-in id until the hub's receipt replaces it.
export const SENDING = "sending:";

/**
 * A message this session sent, with the files it carried. `after` is the time of the coordinator's
 * latest turn the page held when it was sent, so the conversation's copy of the message is a later
 * turn. Both times come from the coordinator's own record: the browser's clock never decides a
 * match.
 */
export type SentMessage = ChatMessage &
  Readonly<{ after: number; files?: readonly ConversationPart[] }>;

/**
 * The time of the coordinator's latest turn; with none, every turn comes after it. Participant
 * turns are left out: their times come from another run's mail.
 */
export const latestTurnAt = (mirror: readonly ConversationTurn[]) =>
  Math.max(
    ...mirror.flatMap((turn) => (turn.role === "participant" ? [] : [turn.at])),
  );

function withFiles(
  turn: TranscriptTurn,
  files: readonly ConversationPart[] | undefined,
): TranscriptTurn {
  if (files === undefined) return turn;
  if (turn.text.length === 0) return { ...turn, parts: files };
  return { ...turn, parts: [...files, { kind: "text", text: turn.text }] };
}

/**
 * The conversation's turns, then this session's sent messages it does not hold yet. The
 * conversation holds a message as mail delivered it, clipped to a turn's length, so a sent
 * message's copy is a later turn with that text.
 */
export function withPendingSends(
  mirror: readonly ConversationTurn[],
  sent: readonly SentMessage[],
): TranscriptTurn[] {
  const pending = [...sent];
  const shown: TranscriptTurn[] = [];
  for (const turn of mirror) {
    const index = pending.findIndex(
      (message) =>
        turn.at > message.after &&
        clippedTurnText(deliveredText(message.body)) === turn.text &&
        turn.role === (message.author === "agent" ? "assistant" : "person"),
    );
    const message = index >= 0 ? pending.splice(index, 1)[0] : undefined;
    shown.push(
      message === undefined || turn.role !== "person"
        ? turn
        : withFiles(turn, message.files),
    );
  }
  for (const message of pending) {
    const at = Date.parse(message.at);
    const turn: TranscriptTurn = {
      role: message.author === "agent" ? "assistant" : "person",
      text: message.body,
      at: Number.isNaN(at) ? 0 : at,
      ...(message.id.startsWith(SENDING) ? { sending: true } : {}),
    };
    shown.push(turn.role === "person" ? withFiles(turn, message.files) : turn);
  }
  return shown;
}
