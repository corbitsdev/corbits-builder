// A command's output when it failed, cut to the end where the failure is, or undefined when it
// passed.
export async function failedCommand(
  command: string[],
  env: Record<string, string> = {},
): Promise<string | undefined> {
  const step = Bun.spawn(command, {
    env: Object.assign({}, process.env, env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    (await new Response(step.stdout).text()) +
    (await new Response(step.stderr).text());
  return (await step.exited) === 0 ? undefined : output.slice(-3000);
}

// One of the project's own package.json scripts.
export const failedScript = (script: string) =>
  failedCommand(["bun", "run", script]);

/**
 * The interface requirements (IR-n) the requirements list that a design's DESIGN.md never names. A
 * design made without a requirements document, or from one with no interface requirements, has
 * none to cover.
 */
export function uncoveredRequirements(
  requirements: string | undefined,
  design: string,
): string[] {
  const section = requirements
    ?.split(/^## Interface requirements/m)[1]
    ?.split(/^## /m)[0];
  const ids = [...new Set(section?.match(/\bIR-\d+\b/g))];
  return ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(design));
}
