import { expect, test } from "bun:test";
import { appCheckDetail, fileCheckedApp } from "./sidecar-tools.ts";

const PASSED =
  "check passed: built, started, and opened / at 1280 and 390 px with no errors";
const MOCKUP_PASSED =
  "check passed: served .builder/designs and opened / at 1280 and 390 px with no errors";

const shell = (command: string) => ({
  id: "call",
  name: "run_shell",
  arguments: { command },
});
const output = (content: string) => ({ callId: "call", content });

test("a check-app run records its verdict however the command runs it", () => {
  for (const command of [
    "check-app",
    "cd app && check-app",
    "timeout 300 check-app",
    "CI=1 check-app",
    "./bin/check-app",
    "bash -lc 'check-app'",
    "timeout 600 check-app 2>&1 | tail -40",
  ])
    expect(appCheckDetail(shell(command), output(PASSED), "check-app")).toEqual(
      {
        checkPassed: true,
      },
    );
});

test("only an app check-app pass of a command that succeeded counts as passed", () => {
  expect(
    appCheckDetail(
      shell("check-app"),
      output("check failed: 1 problem(s)"),
      "check-app",
    ),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(
      shell("check-app .builder/designs"),
      output(MOCKUP_PASSED),
      "check-app",
    ),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(
      shell("check-app"),
      {
        callId: "call",
        content: PASSED,
        isError: true,
      },
      "check-app",
    ),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(
      shell("check-app && bun test"),
      output(`exit code 1\n${PASSED}`),
      "check-app",
    ),
  ).toEqual({ checkPassed: false });
});

test("a command that only names check-app records no verdict", () => {
  expect(
    appCheckDetail(
      shell("grep -rn check-app ."),
      output(`src/check.ts:12: ${PASSED}`),
      "check-app",
    ),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      shell("check-app --help"),
      output("check-app   check the app here"),
      "check-app",
    ),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      { id: "call", name: "read_file", arguments: { path: "check-app" } },
      output(PASSED),
      "check-app",
    ),
  ).toBeUndefined();
});

test("a passing check whose push did not reach the app repository is not filed, and the coder is told so", async () => {
  let filed = false;
  const told = await fileCheckedApp(
    { versionChecked: async () => ({ failure: "refused", stopped: false }) },
    async () => {
      filed = true;
      return 1;
    },
    new AbortController().signal,
  );

  expect({ told, filed }).toEqual({
    told: "The app was not filed: it did not reach the project's app repository (refused). The next passing check files it.",
    filed: false,
  });
});
