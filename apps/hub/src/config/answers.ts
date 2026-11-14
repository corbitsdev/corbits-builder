import { wrongCount, wrongText, type Refusal } from "@corbits-builder/plugin";
import { HUB_NOTE_LEAD } from "./resume.ts";

// The hub's note to the coordinator once the person approved a document they were reading, when no
// open question asked for all of what they have now approved.
export const documentApprovedNote = (kind: string, version: number) =>
  `${HUB_NOTE_LEAD}The person approved the ${kind.replaceAll("_", " ")}, version ${String(version)}.\n\nThey approved it while reading it, without being asked, and Builder recorded the approval of exactly that version, so approved:${kind} holds now and through later versions.`;

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

// The hub's note to the coordinator once the person declined an optional plan step, or restored one.
export const stepDeclinedNote = (title: string, declined: boolean) =>
  declined
    ? `${HUB_NOTE_LEAD}The person declined the plan step "${title}".\n\nDo not start it or do its work another way; carry on with the rest of the plan. It stays declined until they restore it on the plan.`
    : `${HUB_NOTE_LEAD}The person restored the plan step "${title}" they had declined.\n\nIt is part of the plan again; start it when the plan reaches it.`;

// Why a plan step cannot be declined, for the person.
export const STEP_REQUIRED_TEXT =
  "This step is required by the plan, so it cannot be declined. Only a step marked optional can be.";

// The hub's note to the coordinator once the person gave the go-ahead for a step they asked to be consulted on.
export const stepGoAheadNote = (title: string) =>
  `${HUB_NOTE_LEAD}The person gave the go-ahead for the plan step "${title}".\n\nStart it when the plan reaches it.`;

// The hub's note to the coordinator once the person turned "ask me first" on or off for a plan step.
export const stepAskFirstNote = (title: string, askFirst: boolean) =>
  askFirst
    ? `${HUB_NOTE_LEAD}The person asked to be consulted before the plan step "${title}" starts.\n\nDo not start it until they give the go-ahead on the plan.`
    : `${HUB_NOTE_LEAD}The person no longer wants to be consulted before the plan step "${title}" starts.\n\nStart it when the plan reaches it.`;

// Why a plan step cannot be given a go-ahead, for the person.
export const STEP_NOT_ASK_FIRST_TEXT =
  "This step was not set to ask you first, so it needs no go-ahead.";
