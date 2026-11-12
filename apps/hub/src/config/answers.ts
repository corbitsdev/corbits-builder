import { wrongCount, wrongText, type Refusal } from "@corbits-builder/plugin";
import { HUB_NOTE_LEAD } from "./resume.ts";

// The hub's note to the coordinator once the person approved a document they were reading, when no
// open question asked for all of what they have now approved.
export const documentApprovedNote = (kind: string, version: number) =>
  `${HUB_NOTE_LEAD}The person approved the ${kind.replaceAll("_", " ")}, version ${String(version)}.\n\nThey approved it while reading it, without being asked, and Builder recorded the approval of exactly that version, so approved:${kind} holds now. A later version needs their approval again.`;

// The answers route's refusal, written for the person: the screen was shown and its question is
// still open; only the answer they sent does not fit it.
export const answerRefusedText = (screen: string, refusal: Refusal) =>
  [
    `Your answer to ${screen} was not saved because it does not fit what the screen takes. ${wrongCount(refusal)}`,
    "",
    ...wrongText(refusal),
    "",
    "Nothing was saved and the question is still open, so it can be answered again with these corrected.",
  ].join("\n");
