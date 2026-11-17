import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE_INSTALL_TOOL } from "@corbits-builder/schemas/package-install";
import { SANDBOX_SHELL } from "./posix-sandbox.ts";
import {
  appCheckDetail,
  createSidecarCodingTools,
  fileCheckedApp,
  loadedByApp,
  appReadOnly,
  outsideWorkspace,
  workspacePath,
} from "./sidecar-tools.ts";

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

test("a package installed for a scratch file or a test leaves the running app alone, and one for the app's own source restarts it", () => {
  const workspace = "/work/space";
  for (const path of [
    ".scratch/try-export.ts",
    "/work/space/.scratch/deep/probe.tsx",
    "server/src/export.test.ts",
    "client/src/app.spec.tsx",
  ])
    expect([path, loadedByApp(workspace, path)]).toEqual([path, false]);
  for (const path of [
    "server/src/index.ts",
    "/work/space/client/src/app.tsx",
    "packages/shared/src/testing.ts",
  ])
    expect([path, loadedByApp(workspace, path)]).toEqual([path, true]);
});

test("the coder's shell names the commands Builder puts on its PATH and what the sandbox has", async () => {
  const tools = await createSidecarCodingTools({
    role: "coder",
    approval: "allow",
    workspace: {
      kind: "app",
      commands: { "check-stack": "", "check-app": "" },
      commandModules: {},
      pageWatcher: "",
      kit: "",
    },
    packageInstall: "ask",
  })({
    toolCwd: tmpdir(),
    workdir: tmpdir(),
    capabilities: {},
  } as never);
  const described = (name: string) =>
    tools.definitions.find((tool) => tool.name === name)?.description;
  expect(described("run_shell")).toContain(
    "Builder adds check-stack and check-app to PATH: each is a shell command",
  );
  expect(described("run_shell")).toContain(SANDBOX_SHELL);
  expect(described(PACKAGE_INSTALL_TOOL)).toContain("refuses bunx, npx");
});

test("a /workspace path names the workspace's own file, and every path that leaves it is refused", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "builder-workspace-")),
  );
  try {
    await writeFile(join(workspace, "a.txt"), "inside");
    const path = workspacePath(workspace, "/workspace/a.txt");
    expect(outsideWorkspace(workspace, path)).toBe(false);
    expect(await readFile(path, "utf8")).toBe("inside");
    expect(workspacePath(workspace, "a.txt")).toBe("a.txt");
    for (const outside of ["/workspace/../etc/passwd", "/etc/passwd"])
      expect([
        outside,
        outsideWorkspace(workspace, workspacePath(workspace, outside)),
      ]).toEqual([outside, true]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a change cannot rewrite the check commands the project has, and a first build or code with none can write them", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "builder-read-only-"));
  try {
    expect(await appReadOnly(workspace, false)).not.toContain("CHECKS.txt");
    await writeFile(join(workspace, "CHECKS.txt"), "bun run build\n");
    expect(await appReadOnly(workspace, false)).toContain("CHECKS.txt");
    expect(await appReadOnly(workspace, true)).not.toContain("CHECKS.txt");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
