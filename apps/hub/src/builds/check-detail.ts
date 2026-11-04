import { type } from "arktype";

// A check's verdict is read once from its whole output and kept in the result's detail, which
// history trimming leaves alone: a trimmed result loses the "check passed" line the model read.
const CheckDetail = type({ checkPassed: "boolean", "filed?": "boolean" });
export type CheckDetail = typeof CheckDetail.infer;

/** The detail a check tool records, or undefined for any other result. */
export function readCheckDetail(detail: unknown): CheckDetail | undefined {
  const parsed = CheckDetail(detail);
  return parsed instanceof type.errors ? undefined : parsed;
}
