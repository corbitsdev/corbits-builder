import { access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ToolRunner } from "@intx/types/runtime";

// Warm, the starter's client checks in about half a second and cold in under two.
const PROBE_TIMEOUT_MS = 15_000;
const SHOWN_ERRORS = 5;
const TYPE_ERROR = /(^|: )error TS\d+: /;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Typechecks the package a written TypeScript file belongs to and describes its first errors, or
 * returns "" when the file is not TypeScript, has no package tsconfig or the check did not finish.
 * Incremental state is kept in the sandbox's HOME so later probes recheck only what changed.
 */
export async function typeProbe(
  executor: ToolRunner,
  workspace: string,
  path: string,
  callId: string,
  signal: AbortSignal,
) {
  const file = resolve(workspace, path);
  if (!/\.(m|c)?tsx?$/.test(file) || relative(workspace, file).startsWith(".."))
    return "";
  let directory = dirname(file);
  while (!(await exists(join(directory, "tsconfig.json")))) {
    if (directory === workspace || directory === dirname(directory)) return "";
    directory = dirname(directory);
  }
  const project = relative(workspace, directory);
  if (!project) return "";
  const result = await executor.run(
    {
      id: `${callId}-types`,
      name: "run_shell",
      arguments: {
        command: `bun run tsc -p ${quote(project)} --noEmit --pretty false --incremental --tsBuildInfoFile "$HOME"/${quote(`.type-probe/${project.replaceAll("/", "-")}.tsbuildinfo`)}`,
        timeout: PROBE_TIMEOUT_MS,
      },
    },
    signal,
  );
  if (result.isError || typeof result.content !== "string") return "";
  const errors = result.content
    .split("\n")
    .filter((line) => TYPE_ERROR.test(line));
  if (!errors.length)
    return result.content.startsWith("exit code ")
      ? ""
      : `tsc -p ${project}: no type errors.`;
  const more =
    errors.length > SHOWN_ERRORS
      ? `\n- and ${errors.length - SHOWN_ERRORS} more`
      : "";
  return `tsc -p ${project}: ${errors.length} type error${errors.length === 1 ? "" : "s"}\n${errors
    .slice(0, SHOWN_ERRORS)
    .map((error) => `- ${error.slice(0, 300)}`)
    .join("\n")}${more}`;
}
