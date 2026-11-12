// A step both checks run: one of the project's own package.json scripts. Its output when it failed,
// cut to the end where the failure is, or undefined when it passed.
export async function failedScript(
  script: string,
): Promise<string | undefined> {
  const step = Bun.spawn(["bun", "run", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    (await new Response(step.stdout).text()) +
    (await new Response(step.stderr).text());
  return (await step.exited) === 0 ? undefined : output.slice(-3000);
}
