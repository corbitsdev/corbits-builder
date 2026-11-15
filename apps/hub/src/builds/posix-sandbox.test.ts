import { expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { rgPath } from "@vscode/ripgrep";
import { buildPackageLayout } from "./package-layout.ts";
import { createPosixBuildExecutor, publicHostName } from "./posix-sandbox.ts";

test("the open network admits only public names, however a private address is spelled", () => {
  for (const host of [
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    "0177.0.0.1",
    "127.0.0.1.",
    "10.1",
    "2852039166",
    "169.254.169.254",
    "[::1]",
    "::1",
    "[::ffff:127.0.0.1]",
    "localhost",
    "LOCALHOST.",
    "hub.localhost",
    "",
  ])
    expect([host, publicHostName(host)]).toEqual([host, false]);
  for (const host of [
    "registry.npmjs.org",
    "api.open-meteo.com",
    "Example.COM.",
  ])
    expect([host, publicHostName(host)]).toEqual([host, true]);
});

// Exercise real isolation where the host has the required OS sandbox tools.
test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
)(
  "workspace output is writable while host files and approved inputs stay protected",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "builder-sandbox-test-"));
    let executor:
      | Awaited<ReturnType<typeof createPosixBuildExecutor>>
      | undefined;
    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "host-only.txt");
      await mkdir(workspace);
      await writeFile(outside, "host-only-sentinel");
      await writeFile(join(workspace, "brief.md"), "Approved brief");
      const layout = await buildPackageLayout();
      executor = await createPosixBuildExecutor(
        workspace,
        { commandTimeoutMs: 10_000, maxToolResultBytes: 10_000 },
        layout,
        { readOnly: ["brief.md"] },
      );
      const run = (name: string, args: Record<string, unknown>) =>
        executor!.run(
          { id: crypto.randomUUID(), name, arguments: args },
          new AbortController().signal,
        );
      const written = await run("write_file", {
        path: "output.txt",
        content: "Workspace output",
      });
      expect(written.isError).not.toBe(true);
      expect(await readFile(join(workspace, "output.txt"), "utf8")).toBe(
        "Workspace output",
      );
      const output = await run("read_file", { path: "output.txt" });
      expect(output.isError).not.toBe(true);
      expect(output.content).toContain("Workspace output");
      const brief = await run("read_file", { path: "brief.md" });
      expect(brief.isError).not.toBe(true);
      expect(brief.content).toContain("Approved brief");

      const denied = await run("read_file", { path: outside });
      expect(denied.isError).toBe(true);
      expect(denied.content).not.toContain("host-only-sentinel");
      expect((await run("read_file", { path: layout.childPath })).isError).toBe(
        true,
      );
      expect(
        (await run("write_file", { path: "brief.md", content: "changed" }))
          .isError,
      ).toBe(true);
      expect(
        (await run("write_file", { path: outside, content: "changed" }))
          .isError,
      ).toBe(true);
      expect(await readFile(join(workspace, "brief.md"), "utf8")).toBe(
        "Approved brief",
      );
      expect(await readFile(outside, "utf8")).toBe("host-only-sentinel");
    } finally {
      await executor?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
)(
  "a restarted app keeps its ports and its address",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "builder-sandbox-test-"));
    let executor:
      | Awaited<ReturnType<typeof createPosixBuildExecutor>>
      | undefined;
    try {
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: { dev: 'echo "ports $PORT $CLIENT_PORT" && sleep 0.2' },
        }),
      );
      executor = await createPosixBuildExecutor(
        workspace,
        { commandTimeoutMs: 10_000, maxToolResultBytes: 10_000 },
        await buildPackageLayout(),
        { app: true },
      );
      const app = executor;
      const ended = async () => {
        let state = app.appState();
        while (state === undefined || state.running) {
          await Bun.sleep(50);
          state = app.appState();
        }
        return state;
      };
      const ports = (state: { log: string[] }) =>
        state.log.find((line) => line.startsWith("ports "));
      await app.app();
      const first = await ended();
      expect(ports(first)).toBeDefined();

      await app.app();
      const restarted = await ended();
      expect(ports(restarted)).toBe(ports(first));
      expect(restarted.url).toBe(first.url);
    } finally {
      await executor?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
)(
  "a clean workspace exit neither reports a crash nor restarts after an edit or status request",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "builder-sandbox-test-"));
    let executor:
      | Awaited<ReturnType<typeof createPosixBuildExecutor>>
      | undefined;
    try {
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "echo started >> starts.txt; echo '@app/shared build: Exited with code 0'; exec sleep 300",
          },
        }),
      );
      executor = await createPosixBuildExecutor(
        workspace,
        { commandTimeoutMs: 10_000, maxToolResultBytes: 10_000 },
        await buildPackageLayout(),
        { app: true },
      );
      await executor.app();
      const deadline = Date.now() + 5000;
      while (
        !executor
          .appState()
          ?.log.some((line) => line.includes("Exited with code 0")) &&
        Date.now() < deadline
      )
        await Bun.sleep(50);
      expect(executor.appState()?.log.join("\n")).toContain(
        "Exited with code 0",
      );
      expect(executor.appState()?.stopped).toBeUndefined();
      await writeFile(
        join(workspace, "source.ts"),
        "export const changed = true;",
      );
      await Bun.sleep(300);
      await executor.app();
      expect(executor.appState()?.running).toBe(true);
      expect(await readFile(join(workspace, "starts.txt"), "utf8")).toBe(
        "started\n",
      );
    } finally {
      await executor?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
)(
  "workspace tools leave the app unstarted until its first status request",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "builder-sandbox-test-"));
    let executor:
      | Awaited<ReturnType<typeof createPosixBuildExecutor>>
      | undefined;
    try {
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ scripts: { dev: "touch started; exec sleep 300" } }),
      );
      executor = await createPosixBuildExecutor(
        workspace,
        { commandTimeoutMs: 10_000, maxToolResultBytes: 10_000 },
        await buildPackageLayout(),
        { app: true },
      );
      const result = await executor.run(
        { id: "read", name: "read_file", arguments: { path: "package.json" } },
        new AbortController().signal,
      );
      expect(result.isError).not.toBe(true);
      expect(executor.appState()).toBeUndefined();
      expect(await Bun.file(join(workspace, "started")).exists()).toBe(false);
      await executor.app();
      const deadline = Date.now() + 5000;
      while (
        !(await Bun.file(join(workspace, "started")).exists()) &&
        Date.now() < deadline
      )
        await Bun.sleep(50);
      await access(join(workspace, "started"));
      expect(executor.appState()?.running).toBe(true);
    } finally {
      await executor?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
