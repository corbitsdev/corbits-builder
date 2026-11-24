import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { hasCode } from "@intx/types/has-code";
import {
  DEPENDENCY_FIELDS,
  type Manifest,
  readManifest,
} from "./package-install.ts";

const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
};
const BUILTINS = new Set([...builtinModules, "bun"]);
// Relative and absolute paths, node:, bun: and virtual: modules, subpath imports and path aliases.
const NOT_A_PACKAGE = /^(\.|\/|[a-z]+:|#|~|@\/)/;

const packageOf = (specifier: string) => {
  if (NOT_A_PACKAGE.test(specifier)) return undefined;
  const [scope = "", name = ""] = specifier.split("/");
  const root = scope.startsWith("@") ? `${scope}/${name}` : scope;
  return BUILTINS.has(root) ? undefined : root;
};

const declared = (found: typeof Manifest.infer | undefined) => [
  ...(found?.name ? [found.name] : []),
  ...DEPENDENCY_FIELDS.flatMap((field) => Object.keys(found?.[field] ?? {})),
];

/**
 * The packages a source file imports that neither its own package.json nor the workspace root's
 * declares, with that package's folder relative to the workspace.
 */
export async function undeclaredImports(workspace: string, path: string) {
  const file = resolve(workspace, path);
  const loader = LOADERS[file.split(".").pop() ?? ""];
  if (!loader || relative(workspace, file).startsWith("..")) return undefined;
  let imported: string[];
  try {
    const source = await readFile(file, "utf8");
    imported = new Bun.Transpiler({ loader })
      .scanImports(source)
      .map((entry) => entry.path);
  } catch (error) {
    const expected =
      error instanceof BuildMessage ||
      error instanceof AggregateError ||
      (hasCode(error) && error.code === "ENOENT");
    if (!expected) throw error;
    // A file that does not parse yet, or was deleted mid-turn, has no imports to check; check-app says why.
    return undefined;
  }
  let packageDirectory = dirname(file);
  let nearestManifest = await readManifest(
    join(packageDirectory, "package.json"),
  );
  while (
    !nearestManifest &&
    packageDirectory !== workspace &&
    packageDirectory !== dirname(packageDirectory)
  ) {
    packageDirectory = dirname(packageDirectory);
    nearestManifest = await readManifest(
      join(packageDirectory, "package.json"),
    );
  }
  // Without a package.json the project is not an npm one, so nothing is installed for it.
  if (!nearestManifest) return undefined;
  const declaredNames = new Set([
    ...declared(nearestManifest),
    ...declared(await readManifest(join(workspace, "package.json"))),
  ]);
  const packages = [
    ...new Set(imported.flatMap((specifier) => packageOf(specifier) ?? [])),
  ].filter((name) => !declaredNames.has(name));
  return { directory: relative(workspace, packageDirectory), packages };
}
