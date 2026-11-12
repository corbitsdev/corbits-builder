import { type } from "arktype";

// A check's verdict is read once from its whole output and kept in the result's detail, which
// history trimming leaves alone: a trimmed result loses the "check passed" line the model read.
// designChosen: the filed design option was chosen as the design by Builder, without the person.
const CheckDetail = type({
  checkPassed: "boolean",
  "filed?": "boolean",
  "designChosen?": "boolean",
});
export type CheckDetail = typeof CheckDetail.infer;

/** The detail a check tool records, or undefined for any other result. */
export function readCheckDetail(detail: unknown): CheckDetail | undefined {
  const parsed = CheckDetail(detail);
  return parsed instanceof type.errors ? undefined : parsed;
}

// The supervisor's own call: the hub runs the checks a finished reply waits on against the app as
// saved, once the workspace's last version reached it. The model is never offered it.
export const DONE_CHECKS_TOOL = "run_done_checks";

export const DoneChecksCall = type({
  "+": "reject",
  plugin: "string > 0",
  checks: type("string > 0").array().atLeastLength(1),
});

// Each check's result and the commit the saved app was at, or why the checks could not be run.
const DoneChecks = type({
  "commit?": "string > 0",
  results: type({
    check: "string > 0",
    result: "'pass' | 'fail'",
    summary: "string",
    evidence: "string[]",
  }).array(),
}).or({ unrun: "string > 0" });
export type DoneChecks = typeof DoneChecks.infer;

/** What a run_done_checks result records, or, for a result without it, that the checks did not run. */
export function readDoneChecks(result: {
  content: unknown;
  detail?: unknown;
}): DoneChecks {
  const parsed = DoneChecks(result.detail);
  if (!(parsed instanceof type.errors)) return parsed;
  const said =
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
  return { unrun: said.slice(0, 500) || "no answer" };
}
