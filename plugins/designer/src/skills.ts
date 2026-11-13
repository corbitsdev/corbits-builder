import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Bun macros: they run when an agent bundle is built, so the starter and themes ship inside the
// workflow package, each as its directory's files keyed by path.
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

// Each theme's DESIGN.md by its id, without its sample screens, for the designer's looks skill.
export const designThemeDocs = (): Record<string, string> =>
  Object.fromEntries(
    designThemeIds().map((id) => [
      id,
      readFileSync(join(THEMES, id, "DESIGN.md"), "utf8"),
    ]),
  );

export const createThemeSkill = (): string =>
  readFileSync(
    join(import.meta.dir, "..", "skills", "create-theme", "SKILL.md"),
    "utf8",
  );

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
