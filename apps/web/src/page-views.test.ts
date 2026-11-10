import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";

// The linter stops a view importing the hub itself (`.oxlintrc.json`); this is the rule it cannot
// check, that nothing a view renders imports it either.

const root = import.meta.dir;
const transpiler = new Bun.Transpiler({ loader: "tsx" });
const HUB_PACKAGES = new Set([
  "@tanstack/react-query",
  "@corbits-builder/client",
]);

/** The modules a file loads when it runs; imports of types alone are not among them. */
function imported(path: string): string[] {
  return transpiler
    .scan(readFileSync(path, "utf8"))
    .imports.map((entry) => entry.path);
}

/** A relative import's file, written `.jsx` or `.js` for a TypeScript source. */
function sourceOf(from: string, specifier: string): string {
  const path = resolve(dirname(from), specifier);
  const source = [
    path,
    path.replace(/\.jsx$/, ".tsx"),
    path.replace(/\.js$/, ".ts"),
  ].find((candidate) => existsSync(candidate));
  if (source === undefined)
    throw new Error(`${from} imports ${specifier}, which is not a file.`);
  return source;
}

/** Each import through which `view` reaches the hub, as "what, imported by which file". */
function hubImports(view: string): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const walk = (path: string) => {
    if (seen.has(path) || !/\.tsx?$/.test(path)) return;
    seen.add(path);
    const by = relative(root, path);
    for (const specifier of imported(path)) {
      if (HUB_PACKAGES.has(specifier)) found.add(`${specifier}, by ${by}`);
      if (!specifier.startsWith(".")) continue;
      const source = sourceOf(path, specifier);
      const file = relative(root, source);
      if (/^(api|queries)\//.test(file)) found.add(`${file}, by ${by}`);
      else walk(source);
    }
  };
  walk(join(root, view));
  return [...found].sort();
}

test("a view renders nothing that reaches the hub", () => {
  const views = [...new Glob("**/*.view.tsx").scanSync(root)].sort();
  expect(views).not.toEqual([]);
  expect(
    views.flatMap((view) =>
      hubImports(view).map((reached) => `${view} reaches ${reached}`),
    ),
  ).toEqual([]);
});
