import { type } from "arktype";

export const HostReport = type({
  state: "'starting'",
  phase: "'installing' | 'starting'",
  log: "string[]",
})
  .or({ state: "'running'", url: "string" })
  .or({ state: "'failed'", error: "string", log: "string[]" });
export type HostReport = typeof HostReport.infer;
