import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";

// A class a component reads but its module lacks is a type error (see the `css-types` script);
// these are the two rules types cannot check.

const root = import.meta.dir;

function files(pattern: string): string[] {
  return [...new Glob(pattern).scanSync(root)].sort();
}

/** The classes a module defines; `:global(...)` names belong to someone else. */
function moduleClasses(path: string): Set<string> {
  const css = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "")
    .replace(/:global\([^)]*\)/g, "")
    .replace(/"[^"]*"|'[^']*'/g, "");
  return new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]!));
}

/** Every class each module's importers read, keyed by the module's path. */
function classesRead(): Map<string, Set<string>> {
  const read = new Map<string, Set<string>>();
  for (const file of files("**/*.{ts,tsx}")) {
    if (file.endsWith(".d.ts") || /\.test\.tsx?$/.test(file)) continue;
    const path = join(root, file);
    const source = readFileSync(path, "utf8");
    for (const [, local, specifier] of source.matchAll(
      /import\s+(\w+)\s+from\s+"(\.{1,2}\/[^"]+\.module\.css)"/g,
    )) {
      const module = resolve(dirname(path), specifier!);
      const names = read.get(module) ?? new Set<string>();
      for (const [, name] of source.matchAll(
        new RegExp(`\\b${local}\\.([A-Za-z_]\\w*)`, "g"),
      ))
        names.add(name!);
      read.set(module, names);
    }
  }
  return read;
}

describe("component styles", () => {
  test("live in a CSS module beside the component; styles.css holds only what is global", () => {
    const plain = files("**/*.css").filter(
      (file) => file !== "styles.css" && !file.endsWith(".module.css"),
    );
    expect(plain).toEqual([]);
  });

  test("every class a module defines is read by a component", () => {
    const read = classesRead();
    const unused = files("**/*.module.css").flatMap((file) => {
      const names = read.get(join(root, file));
      return [...moduleClasses(join(root, file))]
        .filter((name) => !names?.has(name))
        .map((name) => `${relative(root, join(root, file))}: .${name}`);
    });
    expect(unused).toEqual([]);
  });
});
