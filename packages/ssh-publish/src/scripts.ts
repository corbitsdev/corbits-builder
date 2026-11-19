import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ScriptName =
  | "check"
  | "prepare"
  | "release"
  | "status"
  | "unpublish";

// Imported as a macro, so the bundled agent has each script's text inlined and reads no files.
export function serverScript(name: ScriptName): string {
  const read = (file: string) =>
    readFileSync(join(import.meta.dir, "..", "scripts", file), "utf8");
  return `${read("lib.sh")}\n${read(`${name}.sh`)}`;
}
