import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { rgPath } from "@vscode/ripgrep";
import JSZip from "jszip";
import { COMMAND_BUSY, createCommandRunner } from "./command-runner.ts";

// Real isolation, where the host has the OS sandbox tools.
const sandboxTest = test.skipIf(
  !SandboxManager.isSupportedPlatform() ||
    SandboxManager.checkDependencies({ command: rgPath }).errors.length > 0,
);

const ask = (lines: string[], timeoutMs = 60_000) => ({
  bundle: {
    files: { "package.json": "{}", "src/index.ts": "export {};\n" },
  },
  command: { lines },
  timeoutMs,
  openNetwork: false,
  toolchains: { paths: [], dataDir: tmpdir() },
});
const limits = { maxFiles: 100, maxBytes: 1024 * 1024 };

// The workspace a command printed as its last line, which pwd prints without the trailing
// separator the report strips.
const workspaceOf = (output: string) => output.trim().split("\n").at(-1)!;

sandboxTest(
  "an export packs only the requested paths after every line succeeded, leaves links out, and removes the workspace",
  async () => {
    const commands = createCommandRunner();
    const ran = await commands.run(
      "p-export",
      ask([
        "mkdir -p out/assets other",
        [
          "echo page > out/index.html",
          "echo style > out/assets/site.css",
          "echo kept > notes.txt",
          "echo other > other/file.txt",
          // A link out of the workspace, and one up to the app's root, are never packed.
          "ln -s /etc/hosts out/hosts",
          "ln -s .. out/up",
          "pwd",
        ].join(" && "),
      ]),
      { paths: ["out", "notes.txt"], ...limits },
    );
    if ("error" in ran) throw new Error(ran.error);
    expect(ran.exitCode).toBe(0);
    expect(ran.exported).toEqual({ written: true });
    const zip = await JSZip.loadAsync(ran.archive!);
    const files = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    expect(files).toEqual([
      "notes.txt",
      "out/assets/site.css",
      "out/index.html",
    ]);
    expect(await zip.file("out/index.html")!.async("string")).toBe("page\n");
    expect(existsSync(workspaceOf(ran.output))).toBe(false);
  },
  60_000,
);

sandboxTest(
  "a requested path that is a link, or that runs through one, is refused",
  async () => {
    const commands = createCommandRunner();
    const exported = async (lines: string[], paths: string[]) => {
      const ran = await commands.run("p-refusals", ask(lines), {
        paths,
        ...limits,
      });
      if ("error" in ran) throw new Error(ran.error);
      expect(ran.archive).toBeUndefined();
      return ran.exported;
    };
    expect(
      await exported(
        ["mkdir real && echo x > real/a && ln -s real out"],
        ["out"],
      ),
    ).toEqual({ link: "out" });
    expect(
      await exported(
        ["mkdir real && ln -s real out && echo x > real/a"],
        ["out/a"],
      ),
    ).toEqual({ link: "out/a" });
  },
  60_000,
);

// A name no other run uses, for the marker a command writes once it started and for the processes it
// leaves running, so the test finds them and nothing else.
const uniqueTag = async () => {
  const folder = await mkdtemp(join(tmpdir(), "command-runner-test-"));
  await rm(folder, { recursive: true });
  return basename(folder);
};

// Marks its workspace with tag, then runs a process named for it in the background and one in front,
// each long past any test.
const lingering = (tag: string) => [
  `touch ${tag} && (sh -c 'sleep 3600; true' ${tag} &) ; sh -c 'sleep 3600; true' ${tag}`,
];

// Resolves once the command marked with tag wrote its marker, or once it settled without one.
const started = async (tag: string, settled: Promise<unknown>) => {
  let over = false;
  void settled.finally(() => {
    over = true;
  });
  const marker = new Bun.Glob(`command-check-*/workspace/${tag}`);
  while (!over) {
    for await (const _ of marker.scan({ cwd: tmpdir(), onlyFiles: true }))
      return;
    await Bun.sleep(50);
  }
};

const runningFor = (tag: string) =>
  Bun.spawnSync(["pgrep", "-f", tag]).stdout.toString();

sandboxTest(
  "a second command for a project while one runs is refused, and one past its time is stopped with everything it started",
  async () => {
    const commands = createCommandRunner();
    const tag = await uniqueTag();
    const slow = commands.run("p-busy", ask(lingering(tag), 5_000), {
      paths: ["out"],
      ...limits,
    });
    await started(tag, slow);
    expect(
      await commands.run("p-busy", ask(["true"]), {
        paths: ["out"],
        ...limits,
      }),
    ).toEqual({ error: COMMAND_BUSY });
    const ran = await slow;
    if ("error" in ran) throw new Error(ran.error);
    expect(ran.timedOut).toBe(true);
    expect(ran.archive).toBeUndefined();
    expect(runningFor(tag)).toBe("");
  },
  60_000,
);
