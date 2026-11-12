// A command's output when it failed, cut to the end where the failure is, or undefined when it
// passed.
async function failedCommand(command: string[]): Promise<string | undefined> {
  const step = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const output =
    (await new Response(step.stdout).text()) +
    (await new Response(step.stderr).text());
  return (await step.exited) === 0 ? undefined : output.slice(-3000);
}

// A step both checks run: one of the project's own package.json scripts.
export const failedScript = (script: string) =>
  failedCommand(["bun", "run", script]);

// A step both checks run. The next coder's workspace is prepared with a frozen install, which
// refuses a bun.lock that no longer matches the package.json files, so a stale one strands the
// project. The dry run changes nothing and needs no network for packages already installed.
export async function staleLockfile(): Promise<string | undefined> {
  const failed = await failedCommand([
    "bun",
    "install",
    "--frozen-lockfile",
    "--dry-run",
  ]);
  return failed === undefined
    ? undefined
    : `bun.lock no longer matches package.json: add packages with install_packages, not by editing package.json by hand. Undo the hand edit, or redo it with install_packages so bun.lock is rewritten.\n${failed}`;
}
