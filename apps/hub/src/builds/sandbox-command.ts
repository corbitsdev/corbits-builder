import { quote, type createPosixBuildExecutor } from "./posix-sandbox.ts";

type Executor = Awaited<ReturnType<typeof createPosixBuildExecutor>>;

export const INSTALL_TIMEOUT_MS = 280_000;

/** What one command did in the sandbox; exitCode is null when it did not finish. */
export type SandboxCommand = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};

// run_shell heads a failed command's output with its exit code, and reports one it stopped as an
// error naming the timeout.
const EXIT_HEAD = /^exit code (\d+)\n/;
const TIMED_OUT = "command timed out";

/**
 * Runs one command in the sandbox's workspace, its arguments quoted for the sandbox's shell so
 * none is read as shell syntax. signal stops it early, which throws.
 */
export async function runInSandbox(
  executor: Executor,
  argv: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SandboxCommand> {
  // run_shell's own timeout kills only the shell, and waits on any child still holding its output,
  // so the sandbox's process group is stopped here once the time is up.
  const late = AbortSignal.timeout(timeoutMs + 1_000);
  let result;
  try {
    result = await executor.run(
      {
        id: crypto.randomUUID(),
        name: "run_shell",
        arguments: { command: argv.map(quote).join(" "), timeout: timeoutMs },
      },
      AbortSignal.any([late, ...(signal ? [signal] : [])]),
    );
  } catch (error) {
    if (late.aborted) return { exitCode: null, output: "", timedOut: true };
    throw error;
  }
  const output = String(result.content);
  if (result.isError)
    return { exitCode: null, output, timedOut: output.includes(TIMED_OUT) };
  const head = EXIT_HEAD.exec(output);
  if (!head) return { exitCode: 0, output, timedOut: false };
  return {
    exitCode: Number(head[1]),
    output: output.slice(head[0].length),
    timedOut: false,
  };
}

/** Installs the workspace's packages, as the live app does before it starts. */
export const installPackages = (
  executor: Executor,
  timeoutMs: number,
  signal?: AbortSignal,
) => runInSandbox(executor, ["bun", "install"], timeoutMs, signal);
