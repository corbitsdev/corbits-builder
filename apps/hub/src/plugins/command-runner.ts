import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import { parseJson } from "../lib/json.ts";
import { hostEnv } from "../live-app/runner.ts";
import {
  CommandReport,
  OUTPUT_TAIL_CHARS,
  type CommandAsk,
} from "./command-host.ts";

const HOST = fileURLToPath(new URL("./command-host.ts", import.meta.url));
// After its time is up the host is asked to stop, and killed if it has not stopped this much later.
const STOP_MS = 5_000;

export const COMMAND_BUSY =
  "another command is already running against this project's app";
export const COMMAND_CANCELLED = "the command's caller went away";

// The app paths to pack once the command succeeded, and the most files and bytes the pack may hold.
export type CommandExport = Omit<NonNullable<CommandAsk["export"]>, "archive">;

/** How a command ended, with the zip of the requested paths when an export was written. */
export type CommandOutcome = CommandReport & { archive?: Uint8Array };

// Runs the host on one ask in a fresh workspace, stopping it once its time and STOP_MS are up, or
// as soon as signal aborts, and killing it STOP_MS after either if it has not stopped.
async function runHost(
  workspace: string,
  ask: CommandAsk,
  signal: AbortSignal | undefined,
): Promise<CommandReport> {
  const child = Bun.spawn(
    [process.execPath, ...process.execArgv, HOST, workspace],
    { env: hostEnv(), stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  let stopped = false;
  let kill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    child.kill("SIGTERM");
    kill = setTimeout(() => child.kill("SIGKILL"), STOP_MS);
  };
  const term = setTimeout(stop, ask.timeoutMs + STOP_MS);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    child.stdin.write(JSON.stringify(ask));
    await child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (signal?.aborted === true) return { error: COMMAND_CANCELLED };
    if (stopped)
      return {
        step: null,
        exitCode: null,
        output: stderr.slice(-OUTPUT_TAIL_CHARS),
        timedOut: true,
      };
    const report = CommandReport(
      parseJson(stdout.trim().split("\n").at(-1) ?? ""),
    );
    if (report instanceof type.errors)
      return {
        error: `the command host exited ${code} without a report: ${stderr.slice(-OUTPUT_TAIL_CHARS)}`,
      };
    return report;
  } finally {
    clearTimeout(term);
    clearTimeout(kill);
    signal?.removeEventListener("abort", stop);
  }
}

/**
 * Runs commands against saved app versions for checks and builds. Each runs in a separate host
 * process (one sandbox per process) with a temporary workspace that is removed afterwards, whatever
 * the outcome. A project runs one command at a time: a second command while one runs is refused,
 * never queued. When the caller's signal aborts, the command is stopped, which frees its project
 * for the next.
 */
export function createCommandRunner() {
  const running = new Set<string>();
  return {
    async run(
      projectId: string,
      ask: Omit<CommandAsk, "export">,
      exported?: CommandExport,
      signal?: AbortSignal,
    ): Promise<CommandOutcome> {
      if (signal?.aborted === true) return { error: COMMAND_CANCELLED };
      if (running.has(projectId)) return { error: COMMAND_BUSY };
      running.add(projectId);
      try {
        const root = await mkdtemp(join(tmpdir(), "command-check-"));
        try {
          const workspace = join(root, "workspace");
          await mkdir(workspace);
          // Next to the workspace, where the sandbox cannot write.
          const archive = join(root, "export.zip");
          const report = await runHost(
            workspace,
            exported ? { ...ask, export: { ...exported, archive } } : ask,
            signal,
          );
          if (
            "exported" in report &&
            report.exported &&
            "written" in report.exported
          )
            return { ...report, archive: await Bun.file(archive).bytes() };
          return report;
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      } finally {
        running.delete(projectId);
      }
    },
  };
}
