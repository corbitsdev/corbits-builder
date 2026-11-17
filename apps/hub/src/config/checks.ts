import { HUB_NOTE_LEAD } from "@corbits-builder/schemas/conversation";

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

// What a reply held by its finish check is told, one fact per state, each with the next step.
export const FINISH_CHECK_HOLDS = {
  unrun: (check: string) =>
    `${check} has not run in this task, so the work is not done yet. Run ${check} after your last change.`,
  failed: (check: string) =>
    `The last ${check} run failed, so the work is not done yet. Fix what it reported and run ${check} again after your last change.`,
  changed: (check: string) =>
    `Files changed after ${check} last passed, so the work is not done yet. Make ${check} your last call; any change after it counts, even one to a build folder.`,
};
