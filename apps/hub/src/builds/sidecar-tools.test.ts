import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appCheckDetail, fileCheckedApp } from "./sidecar-tools.ts";

const PASSED = "check passed: every command in CHECKS.txt succeeded";

const shell = (command: string) => ({
  id: "call",
  name: "run_shell",
  arguments: { command },
});
const output = (content: string) => ({ callId: "call", content });

test("a check-stack run records its verdict however the command runs it", () => {
  for (const command of [
    "check-stack",
    "cd app && check-stack",
    "timeout 300 check-stack",
    "CI=1 check-stack",
    "./bin/check-stack",
    "bash -lc 'check-stack'",
    "timeout 600 check-stack 2>&1 | tail -40",
  ])
    expect(appCheckDetail(shell(command), output(PASSED))).toEqual({
      checkPassed: true,
    });
});

test("only a check-stack pass of a command that succeeded counts as passed", () => {
  expect(
    appCheckDetail(
      shell("check-stack"),
      output("check failed: check-app exited non-zero"),
    ),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(shell("check-stack"), {
      callId: "call",
      content: PASSED,
      isError: true,
    }),
  ).toEqual({ checkPassed: false });
  expect(
    appCheckDetail(
      shell("check-stack && bun test"),
      output(`exit code 1\n${PASSED}`),
    ),
  ).toEqual({ checkPassed: false });
});

test("check-stack passes only when every command in CHECKS.txt succeeds, and the coder's tools read its verdict", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "check-stack-"));
  const script = join(
    import.meta.dir,
    "../../../../plugins/coder/check/check-stack.ts",
  );
  const run = async (checks: string) => {
    await writeFile(join(workspace, "CHECKS.txt"), checks);
    const child = Bun.spawn(["bun", script], {
      cwd: workspace,
      stdout: "pipe",
    });
    const content = await new Response(child.stdout).text();
    const code = await child.exited;
    return code === 0
      ? output(content)
      : output(`exit code ${code}\n${content}`);
  };
  try {
    expect(
      appCheckDetail(shell("check-stack"), await run("echo one\n\necho two\n")),
    ).toEqual({ checkPassed: true });
    expect(
      appCheckDetail(
        shell("check-stack"),
        await run("echo one\nfalse\necho three\n"),
      ),
    ).toEqual({ checkPassed: false });
    expect(appCheckDetail(shell("check-stack"), await run(""))).toEqual({
      checkPassed: false,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a command that only names check-stack, or runs check-app on its own, records no verdict", () => {
  expect(
    appCheckDetail(
      shell("grep -rn check-stack ."),
      output(`src/check.ts:12: ${PASSED}`),
    ),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      shell("check-stack --help"),
      output("check-stack   run each command in CHECKS.txt"),
    ),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      { id: "call", name: "read_file", arguments: { path: "check-stack" } },
      output(PASSED),
    ),
  ).toBeUndefined();
  expect(
    appCheckDetail(
      shell("check-app"),
      output("check passed: built, started, and opened / at 1280 and 390 px"),
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
