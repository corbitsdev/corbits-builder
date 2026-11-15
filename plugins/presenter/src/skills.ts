import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const files = (root: string, directory = root): [string, string][] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(root, join(directory, entry.name))
      : [
          [
            relative(root, join(directory, entry.name)),
            readFileSync(join(directory, entry.name), "utf8"),
          ],
        ],
  );

// A Bun macro: it runs when an agent bundle is built, so the presenting skill ships inside the
// workflow package. Each skill is its directory's files keyed by path, SKILL.md first.
export const presentingSkills = (): Record<string, Record<string, string>> => {
  const root = join(import.meta.dir, "..", "skills");
  return Object.fromEntries(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        entry.name,
        Object.fromEntries(
          files(join(root, entry.name)).sort(([a], [b]) => {
            if (a === "SKILL.md") return -1;
            if (b === "SKILL.md") return 1;
            return a.localeCompare(b);
          }),
        ),
      ]),
  );
};
