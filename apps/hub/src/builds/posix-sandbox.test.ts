import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { rgPath } from "@vscode/ripgrep";
import { declaredRun, starterValues } from "@corbits-builder/plugin";
import { type } from "arktype";
import { CATALOG } from "../plugins/catalog.ts";
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
const sandboxTest = test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
);

sandboxTest(
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

// A real sandbox whose workspace holds files, with programs allowed to keep running in it.
async function withRunner(
  files: Record<string, string>,
  use: (
    executor: Awaited<ReturnType<typeof createPosixBuildExecutor>>,
    workspace: string,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "builder-runner-test-"));
  let executor:
    | Awaited<ReturnType<typeof createPosixBuildExecutor>>
    | undefined;
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    for (const [path, content] of Object.entries(files))
      await writeFile(join(workspace, path), content);
    executor = await createPosixBuildExecutor(
      workspace,
      { commandTimeoutMs: 10_000, maxToolResultBytes: 64_000 },
      await buildPackageLayout(),
      { app: true },
    );
    await use(executor, workspace);
  } finally {
    await executor?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

async function untilReady(
  executor: Awaited<ReturnType<typeof createPosixBuildExecutor>>,
) {
  const deadline = Date.now() + 15_000;
  while (!executor.appState()?.ready && Date.now() < deadline)
    await Bun.sleep(100);
  return executor.appState();
}

sandboxTest(
  "a program that keeps running stays ready across later calls and is gone once the run ends",
  async () => {
    await withRunner({}, async (executor, workspace) => {
      await executor.app({
        run: {
          // Anything still running a few seconds after the run ends writes late.txt.
          command:
            "echo listening on $PORT; (sleep 3; echo child > late.txt) & exec sleep 300",
          port: "PORT",
          waitFor: "listening",
        },
        page: false,
      });
      const first = await untilReady(executor);
      if (!first) throw new Error("program_never_started");
      expect(first).toMatchObject({ running: true, ready: true });
      expect(first.log.join("\n")).toMatch(/listening on \d+/);
      const between = await executor.run(
        { id: "between", name: "run_shell", arguments: { command: "true" } },
        new AbortController().signal,
      );
      expect(between.isError).not.toBe(true);
      const second = await executor.app();
      expect(second).toMatchObject({ running: true, ready: true });
      expect(second.log).toEqual(first.log);
      await executor.dispose();
      await Bun.sleep(4_000);
      expect(await Bun.file(join(workspace, "late.txt")).exists()).toBe(false);
    });
  },
  60_000,
);

sandboxTest(
  "the web starter's program starts as the stack.run its first build saves declares and answers on its address",
  async () => {
    const run = declaredRun(
      starterValues({
        name: "web-app",
        starter: CATALOG.appStarters.get("web-app")!,
      }),
    );
    if (!run || run instanceof type.errors)
      throw new Error("web_starter_saves_no_run");
    await withRunner(
      {
        "package.json": JSON.stringify({
          scripts: {
            dev: "bun -e 'Bun.serve({ port: Number(process.env.CLIENT_PORT), fetch: () => new Response(process.env.PORT) }); console.log(\"ready\")'",
          },
        }),
      },
      async (executor) => {
        const app = await executor.app({ run, page: false });
        expect(app.command).toBe("bun run dev");
        const deadline = Date.now() + 15_000;
        let body: string | undefined;
        while (body === undefined && Date.now() < deadline) {
          try {
            body = await (await fetch(app.url)).text();
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            await Bun.sleep(200);
          }
        }
        // The server half gets a port of its own, apart from the address the client answers on.
        expect(body).toMatch(/^\d+$/);
        expect(app.url).not.toEndWith(`:${body}`);
        expect(executor.appState()).toMatchObject({
          running: true,
          ready: true,
        });
      },
    );
  },
  60_000,
);
