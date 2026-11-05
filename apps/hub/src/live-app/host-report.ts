import { type } from "arktype";
import { liveAppWording } from "../config/live-app.ts";
import { parseJson } from "../lib/json.ts";

export const HostReport = type({
  state: "'starting'",
  phase: "'installing' | 'starting'",
  log: "string[]",
})
  .or({ state: "'running'", url: "string" })
  .or({ state: "'failed'", error: "string", log: "string[]" });
export type HostReport = typeof HostReport.infer;

/** Runs one state check; a check that throws reports a failed state, so one bad check never ends the host. */
export async function reportState(
  check: () => Promise<HostReport | undefined>,
  report: (state: HostReport) => void,
  failed: (error: unknown) => void,
) {
  let state: HostReport | undefined;
  try {
    state = await check();
  } catch (error) {
    failed(error);
    state = { state: "failed", error: liveAppWording.checkFailed, log: [] };
  }
  if (state) report(state);
}

/** Each report the host writes to stdout, in order; a line that is not a report is skipped, so one bad line never freezes the state. */
export async function* hostReports(
  stdout: ReadableStream<Uint8Array>,
  skipped: (reason: "not JSON" | "not a report") => void,
): AsyncGenerator<HostReport> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stdout) {
    pending += decoder.decode(chunk, { stream: true });
    for (
      let end = pending.indexOf("\n");
      end !== -1;
      end = pending.indexOf("\n")
    ) {
      const json = parseJson(pending.slice(0, end));
      pending = pending.slice(end + 1);
      const report = json === undefined ? undefined : HostReport(json);
      if (report === undefined) skipped("not JSON");
      else if (report instanceof type.errors) skipped("not a report");
      else yield report;
    }
  }
}
