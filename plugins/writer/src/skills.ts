import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A Bun macro: it runs when an agent bundle is built, so the skills ship inside the workflow
// package. Each skill is SKILL.md and its reference files, keyed by path, SKILL.md first.
export const documentSkills = (): Record<string, Record<string, string>> => {
  const root = join(import.meta.dir, "..", "skills");
  return Object.fromEntries(
    readdirSync(root).map((name) => [
      name,
      Object.fromEntries([
        ["SKILL.md", readFileSync(join(root, name, "SKILL.md"), "utf8")],
        ...readdirSync(join(root, name, "reference"))
          .sort()
          .map((file) => [
            "reference/" + file,
            readFileSync(join(root, name, "reference", file), "utf8"),
          ]),
      ]),
    ]),
  );
};
