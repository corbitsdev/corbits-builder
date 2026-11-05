import { expect, test } from "bun:test";
import { liveAppWording } from "../config/live-app.ts";
import { hostReports, reportState, type HostReport } from "./host-report.ts";

test("a state check that throws reports failed, and the next check still reports", async () => {
  const reported: HostReport[] = [];
  const failures: unknown[] = [];
  const checks = [
    () => Promise.reject(new Error("executor_failed")),
    () => Promise.resolve<HostReport>({ state: "running", url: "http://app" }),
  ];
  for (const check of checks)
    await reportState(
      check,
      (state) => reported.push(state),
      (error) => failures.push(error),
    );
  expect(reported).toEqual([
    { state: "failed", error: liveAppWording.checkFailed, log: [] },
    { state: "running", url: "http://app" },
  ]);
  expect(failures).toHaveLength(1);
});

test("a bad state line between two good ones is skipped, and the state ends on the second", async () => {
  const lines = [
    '{"state":"starting","phase":"installing","log":[]}\n',
    "not json\n",
    '{"state":"running"}\n',
    '{"state":"running","url":"http://app"}\n',
  ];
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split mid-line so a report spanning chunks still parses.
      const bytes = new TextEncoder().encode(lines.join(""));
      controller.enqueue(bytes.slice(0, 10));
      controller.enqueue(bytes.slice(10));
      controller.close();
    },
  });
  const skipped: string[] = [];
  const reports: HostReport[] = [];
  for await (const report of hostReports(stdout, (reason) =>
    skipped.push(reason),
  ))
    reports.push(report);
  expect(skipped).toEqual(["not JSON", "not a report"]);
  expect(reports.at(-1)).toEqual({ state: "running", url: "http://app" });
  expect(reports).toHaveLength(2);
});
