import { HUB_NOTE_LEAD } from "./resume.ts";

const OUTCOME = { pass: "passed", fail: "failed" } as const;

/** What the coordinator is told of a check's result that it did not wait on itself. */
export const checkNote = (check: {
  name: string;
  checkId: string;
  result: "pass" | "fail";
  summary: string;
  evidence: readonly string[];
}) =>
  [
    `${HUB_NOTE_LEAD}The ${check.name} check ${OUTCOME[check.result]}.`,
    "",
    check.summary,
    ...check.evidence,
    "",
    `Check ${check.checkId}. It looked at the project as saved; a step that needs what it proves can start only while its latest result is a pass for what the project now has.`,
  ].join("\n");

/** What the coordinator is told when the person skips a check. */
export const checkSkippedNote = (check: {
  name: string;
  checkId: string;
  summary: string;
}) =>
  [
    `${HUB_NOTE_LEAD}The person skipped the ${check.name} check.`,
    "",
    `Its last result was: ${check.summary}`,
    `Check ${check.checkId}. What it proves now counts as true, until the project changes what it looked at.`,
  ].join("\n");

export const CHECK_SKIPPED = "Skipped by the person.";
