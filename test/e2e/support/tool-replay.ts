import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type } from "arktype";
import { createPosixTools } from "@intx/tools-posix";
import { hasCode } from "@intx/types/has-code";
import { ToolResult, type ToolCall } from "@intx/types/runtime";
import type { createPosixBuildExecutor } from "../../../apps/hub/src/builds/posix-sandbox.ts";

// The sandbox's policy is left out: there is no sandbox, and nothing reads it.
type Executor = Omit<
  Awaited<ReturnType<typeof createPosixBuildExecutor>>,
  "policy"
>;
type ExecutorOptions = Parameters<typeof createPosixBuildExecutor>[3];

/**
 * What a hub's toolReplay is set to for the recordings in folder. The hub imports the value as a
 * module and knows nothing of recordings; the folder rides in the module's query.
 */
export const toolReplay = (folder: string) =>
  `${import.meta.path}?recordings=${encodeURIComponent(folder)}`;

const Recording = type({
  "+": "reject",
  shell: "string > 0",
  result: ToolResult,
}).or({
  "+": "reject",
  command: "string > 0",
  exitCode: "number.integer",
  output: "string",
});
const CHECKS = /\bcheck-(?:stack|app)\b/;
// A check's verdict heads a line of its output, which is what the hub reads.
const CHECK_VERDICT = /^check (?:passed|failed):/m;

// Whether a path is the folder or inside it.
const contains = (parent: string, path: string) => {
  const tail = relative(parent, path);
  return tail === "" || (tail !== ".." && !tail.startsWith(`..${sep}`));
};

/**
 * The recordings in the folder by the line each answers, checked as they are read: a check's must
 * carry its verdict line, and a line recorded twice is refused. A line with no recording throws, so
 * nothing falls back to running it.
 */
async function readReplay(folder: string) {
  const shells = new Map<string, ToolResult>();
  const commands = new Map<string, { exitCode: number; output: string }>();
  for (const name of await readdir(folder)) {
    if (!name.endsWith(".json")) continue;
    const recorded = Recording.assert(
      JSON.parse(await readFile(join(folder, name), "utf8")),
    );
    const line = "shell" in recorded ? recorded.shell : recorded.command;
    const output =
      "shell" in recorded ? String(recorded.result.content) : recorded.output;
    if (CHECKS.test(line) && !CHECK_VERDICT.test(output))
      throw new Error(
        `tool_replay_invalid: ${name} records a check without its verdict`,
      );
    if (shells.has(line) || commands.has(line))
      throw new Error(`tool_replay_invalid: ${line} twice`);
    if ("shell" in recorded) shells.set(line, recorded.result);
    else
      commands.set(line, {
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
    shell: (call: ToolCall): ToolResult => ({
      ...recordingOf(shells, String(call.arguments["command"])),
      callId: call.id,
    }),
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
export async function createReplayExecutor(
  workspace: string,
  options: ExecutorOptions,
): Promise<Executor> {
  const folder = new URL(import.meta.url).searchParams.get("recordings");
  if (!folder) throw new Error("tool_replay_recordings_required");
  const cwd = await realpath(workspace);
  const replay = await readReplay(folder);
  const tools = createPosixTools({ cwd });
  const readOnly = options?.readOnly ?? [];
  const unsupported = (member: string) => (): never => {
    throw new Error(`tool_replay_unsupported: ${member}`);
  };
  // As in the sandbox, a path is refused by where it resolves, through links, not by how it is named.
  const allows = async (call: ToolCall) => {
    const named = call.arguments["path"];
    let path = resolve(cwd, typeof named === "string" ? named : ".");
    if (
      (call.name === "write_file" || call.name === "edit_file") &&
      readOnly.some((folder) => contains(join(cwd, folder), path))
    )
      return false;
    for (;;) {
      try {
        return contains(cwd, await realpath(path));
      } catch (error) {
        if (!hasCode(error) || error.code !== "ENOENT") throw error;
        path = dirname(path);
      }
    }
  };
  return {
    version: "replay",
    async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      if (call.name === "run_shell") return replay.shell(call);
      if (!(await allows(call)))
        return {
          callId: call.id,
          content: `refused: ${String(call.arguments["path"])} is outside what this workspace lets the tool touch`,
          isError: true,
        };
      return tools.run(call, signal);
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
}
