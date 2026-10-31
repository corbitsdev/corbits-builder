import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// A Bun macro: it runs when an agent bundle is built, so the skills ship inside the workflow
// package. Each skill is its directory's files keyed by path, SKILL.md first.
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

export const designSkills = (): Record<string, Record<string, string>> => {
  const root = join(import.meta.dir, "..", "skills");
  return Object.fromEntries(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        entry.name,
        Object.fromEntries(
          files(join(root, entry.name)).sort(([a], [b]) =>
            a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b),
          ),
        ),
      ]),
  );
};

export const designStarterFiles = (): Record<string, string> =>
  Object.fromEntries(
    files(join(import.meta.dir, "..", "starter")).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );

const THEMES = join(import.meta.dir, "..", "themes");

export const designThemeIds = (): string[] =>
  readdirSync(THEMES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

// The design themes a person can preview and pick before any design exists, keyed by the
// catalog's concept id: each a design bundle (DESIGN.md and designs/) of one sample app.
export const designThemes = (): Record<string, Record<string, string>> =>
  Object.fromEntries(
    designThemeIds().map((id) => [
      id,
      Object.fromEntries(
        files(join(THEMES, id)).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ]),
  );
