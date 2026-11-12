import { readFileSync } from "node:fs";
import { join } from "node:path";

// A Bun macro: it runs when an agent bundle is built, so the guidance ships inside the workflow package.
export const guidance = (): string =>
  readFileSync(join(import.meta.dir, "..", "SKILL.md"), "utf8");
