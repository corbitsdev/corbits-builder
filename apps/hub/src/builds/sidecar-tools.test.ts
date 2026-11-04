import { expect, test } from "bun:test";
import { appCheckDetail } from "./sidecar-tools.ts";

const PASSED =
  "check passed: built, started, and opened / at 1280 and 390 px with no errors";

const shell = (command: string) => ({
  id: "call",
  name: "run_shell",
  arguments: { command },
});
const output = (content: string) => ({ callId: "call", content });

test("a check-app run records its verdict, and only a real check-app run records one", () => {
  expect(appCheckDetail(shell("check-app"), output(PASSED))).toEqual({
    checkPassed: true,
  });
  expect(appCheckDetail(shell("cd app && check-app"), output(PASSED))).toEqual({
    checkPassed: true,
  });
  expect(
    appCheckDetail(shell("check-app"), output("check failed: 1 problem(s)")),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(shell("check-app"), {
      callId: "call",
      content: PASSED,
      isError: true,
    }),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(
      shell("check-app && bun test"),
      output(`exit code 1\n${PASSED}`),
    ),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(shell("grep -rn check-app ."), output(PASSED)),
  ).toBeUndefined();
  expect(
    appCheckDetail(shell("cat bin/check-app"), output(PASSED)),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      { id: "call", name: "read_file", arguments: { path: "check-app" } },
      output(PASSED),
    ),
  ).toBeUndefined();
});
