/**
 * The composer's placeholder, read from the room's facts about the project, which the status line
 * reads too. An open approval has a line of its own.
 */
import { wording } from "../../config.ts";
import type { RoomStatusFacts } from "./room-status.ts";

const copy = wording.composer;

export function composerPlaceholder(input: {
  approvalOpen: boolean;
  /** The coordinator's questions wait on the person; a message sent instead answers them in its own words. */
  questionsOpen: boolean;
  /** What the open question's screen asks of the prompt box, when it says. */
  screenReply: string | undefined;
  facts: Pick<RoomStatusFacts, "thinking" | "working" | "failed" | "app">;
  /** No pane deliverables, design draft, or concepts yet. */
  nothingFiled: boolean;
}): string {
  if (input.approvalOpen) return wording.approval.composerPlaceholder;
  if (input.questionsOpen)
    return input.screenReply ?? wording.questions.composerPlaceholder;
  const { thinking, working, failed, app } = input.facts;
  // Work under way asks for a reply, and names no one.
  if (thinking || working.length > 0) return copy.reply;
  if (app === "running") return copy.change;
  if (app === "failed" || failed.length > 0) return copy.fix;
  if (input.nothingFiled) return copy.making;
  return copy.reply;
}
