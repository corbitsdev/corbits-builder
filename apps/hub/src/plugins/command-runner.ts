import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import type { CommandSteps } from "@corbits-builder/plugin";
import type { AppBundle } from "@corbits-builder/schemas/artifact";
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

// Runs the host on one ask in a fresh workspace, stopping it once its time and STOP_MS are up.
async function runHost(
  workspace: string,
  ask: CommandAsk,
): Promise<CommandReport> {
  const child = Bun.spawn(
    [process.execPath, ...process.execArgv, HOST, workspace],
    { env: hostEnv(), stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  let stopped = false;
  const term = setTimeout(() => {
    stopped = true;
    child.kill("SIGTERM");
  }, ask.timeoutMs + STOP_MS);
  const kill = setTimeout(
    () => child.kill("SIGKILL"),
    ask.timeoutMs + 2 * STOP_MS,
  );
  try {
    child.stdin.write(JSON.stringify(ask));
    await child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (stopped)
      return {
        step: "command",
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
  }
}

/**
 * Runs commands against saved app versions for checks: each in a host process of its own (one
 * sandbox per process) with a temporary workspace removed afterwards, and one at a time per
 * project. A second command for a project while one runs is refused, never queued.
 */
export function createCommandRunner() {
  const running = new Set<string>();
  return {
    async run(
      projectId: string,
      bundle: AppBundle,
      command: CommandSteps,
      timeoutMs: number,
    ): Promise<CommandReport> {
      if (running.has(projectId)) return { error: COMMAND_BUSY };
      running.add(projectId);
      try {
        const root = await mkdtemp(join(tmpdir(), "command-check-"));
        try {
          const workspace = join(root, "workspace");
          await mkdir(workspace);
          return await runHost(workspace, {
            bundle,
            command,
            timeoutMs,
          });
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      } finally {
        running.delete(projectId);
      }
    },
  };
}
