import {
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type } from "arktype";
import { createPosixTools } from "@intx/tools-posix";
import { ToolResult, type ToolCall } from "@intx/types/runtime";
import type { ReplayExecutorFactory } from "@corbits-builder/hub/builds/posix-sandbox";

/**
 * What a hub's toolReplay is set to for the recordings in folder. The hub imports the value as a
 * module and knows nothing of recordings; the folder rides in the module's query. With
 * E2E_REAL_TOOLS=1 there is none, and the hub runs the real tools in its sandbox.
 */
export const toolReplay = (folder: string) =>
  process.env["E2E_REAL_TOOLS"] === "1"
    ? undefined
    : `${import.meta.path}?recordings=${encodeURIComponent(folder)}`;

const Shell = type({
  "+": "reject",
  shell: "string > 0",
  result: ToolResult,
  "writes?": "Record<string, string>",
});
const Recording = Shell.or({
  "+": "reject",
  command: "string > 0",
  exitCode: "number.integer",
  output: "string",
});

/**
 * The recordings in the folder by the line each answers. A line with no recording throws, so nothing
 * falls back to running it.
 */
async function readReplay(folder: string) {
  const shells = new Map<string, typeof Shell.infer>();
  const commands = new Map<string, { exitCode: number; output: string }>();
  for (const name of await readdir(folder)) {
    if (!name.endsWith(".json")) continue;
    const recorded = Recording.assert(
      JSON.parse(await readFile(join(folder, name), "utf8")),
    );
    if ("shell" in recorded) shells.set(recorded.shell, recorded);
    else
      commands.set(recorded.command, {
        exitCode: recorded.exitCode,
        output: recorded.output,
      });
  }
  const recordingOf = <T>(answers: Map<string, T>, line: string) => {
    const answer = answers.get(line);
    if (answer === undefined)
      throw new Error(`tool_replay_unrecorded: ${line}`);
    return answer;
  };
  return {
    shell: (line: string) => recordingOf(shells, line),
    command: (name: string, args: readonly string[]) =>
      recordingOf(commands, [name, ...args].join(" ")),
  };
}

/**
 * The hub's build executor for the build tests, which starts no sandbox: the posix tools run here on
 * the workspace, and shell lines and commands are answered from the recordings named in this
 * module's query. An app, a browser or a gate is never started, so asking for one fails the test by
 * name.
 */
export const createReplayExecutor: ReplayExecutorFactory = async (
  workspace,
) => {
  const folder = new URL(import.meta.url).searchParams.get("recordings");
  if (!folder) throw new Error("tool_replay_recordings_required");
  const cwd = await realpath(workspace);
  const replay = await readReplay(folder);
  const tools = createPosixTools({ cwd });
  const unsupported = (member: string) => (): never => {
    throw new Error(`tool_replay_unsupported: ${member}`);
  };
  return {
    version: "replay",
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      if (call.name !== "run_shell") return tools.run(call, signal);
      const recorded = replay.shell(String(call.arguments["command"]));
      for (const [path, content] of Object.entries(recorded.writes ?? {})) {
        const target = resolve(cwd, path);
        const tail = relative(cwd, target);
        if (tail === ".." || tail.startsWith(`..${sep}`))
          throw new Error(
            `tool_replay_invalid: ${path} is outside the workspace`,
          );
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      return { ...recorded.result, callId: call.id };
    },
    async command(name: string, args: readonly string[], signal: AbortSignal) {
      signal.throwIfAborted();
      return replay.command(name, args);
    },
    reports: () => [],
    runGate: unsupported("runGate"),
    violationCount: () => 0,
    app: unsupported("app"),
    browser: unsupported("browser"),
    appState: () => undefined,
    restartApp: () => undefined,
    dispose: () => tools.dispose(),
  };
};
