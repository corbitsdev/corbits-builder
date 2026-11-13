// Runs one command against a saved app version for a check, in the coder's sandbox. srt's sandbox
// manager is process-global, so each run is a process of its own. stdin carries the app's files and
// the command; the files go into the workspace named in argv, the command's setup runs when it
// declares one, and then the command, both with the registry-only network. One JSON line on stdout says how it went, and the
// process exits. SIGTERM stops the command and its sandbox first.
import { sep } from "node:path";
import { type } from "arktype";
import { AppBundle } from "@corbits-builder/schemas/artifact";
import { writeBundle } from "../artifacts/design-tools.ts";
import { bundleFiles } from "../builds/app-snapshot.ts";
import { buildPackageLayout } from "../builds/package-layout.ts";
import { createPosixBuildExecutor } from "../builds/posix-sandbox.ts";
import {
  runInSandbox,
  type SandboxCommand,
} from "../builds/sandbox-command.ts";

export const CommandAsk = type({
  "+": "reject",
  bundle: AppBundle,
  command: {
    "+": "reject",
    "setup?": "(string > 0)[] >= 1",
    run: "(string > 0)[] >= 1",
  },
  timeoutMs: "number.integer > 0",
});
export type CommandAsk = typeof CommandAsk.infer;

export const CommandReport = type({
  "+": "reject",
  step: "'setup' | 'command'",
  exitCode: "number.integer | null",
  output: "string",
  timedOut: "boolean",
}).or({ "+": "reject", error: "string" });
export type CommandReport = typeof CommandReport.infer;

// How much of a command's output the report keeps, from its end.
export const OUTPUT_TAIL_CHARS = 4096;
// What the sandbox may return of one command before it is stopped.
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

async function runCommand(
  workspace: string,
  ask: CommandAsk,
  signal: AbortSignal,
): Promise<CommandReport> {
  const deadline = Date.now() + ask.timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  await writeBundle(workspace, bundleFiles(ask.bundle));
  const executor = await createPosixBuildExecutor(
    workspace,
    {
      commandTimeoutMs: ask.timeoutMs + 10_000,
      maxToolResultBytes: OUTPUT_LIMIT_BYTES,
    },
    await buildPackageLayout(),
  );
  const shown = (step: "setup" | "command", ran: SandboxCommand) => ({
    step,
    exitCode: ran.exitCode,
    output: ran.output
      .replaceAll(workspace + sep, "")
      .slice(-OUTPUT_TAIL_CHARS),
    timedOut: ran.timedOut,
  });
  try {
    const { setup, run } = ask.command;
    if (setup) {
      const prepared = await runInSandbox(executor, setup, left(), signal);
      if (prepared.exitCode !== 0) return shown("setup", prepared);
    }
    return shown("command", await runInSandbox(executor, run, left(), signal));
  } finally {
    await executor.dispose();
  }
}

if (import.meta.main) {
  const stopping = new AbortController();
  process.once("SIGTERM", () => stopping.abort(new Error("stopped")));
  let report: CommandReport;
  try {
    const workspace = process.argv[2];
    if (!workspace) throw new Error("command_workspace_required");
    const ask = CommandAsk.assert(JSON.parse(await Bun.stdin.text()));
    report = await runCommand(workspace, ask, stopping.signal);
  } catch (error) {
    report = { error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exit("error" in report ? 1 : 0);
}
