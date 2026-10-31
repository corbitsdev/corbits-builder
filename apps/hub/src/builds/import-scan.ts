import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { DEPENDENCY_FIELDS, Manifest } from "./package-install.ts";

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

async function manifest(path: string) {
  try {
    return Manifest.assert(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

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
    imported = new Bun.Transpiler({ loader })
      .scanImports(await readFile(file, "utf8"))
      .map((entry) => entry.path);
  } catch {
    // A file that does not parse yet has no imports to check; check-app says why.
    return undefined;
  }
  let directory = dirname(file);
  let own = await manifest(join(directory, "package.json"));
  while (!own && directory !== workspace && directory !== dirname(directory)) {
    directory = dirname(directory);
    own = await manifest(join(directory, "package.json"));
  }
  const known = new Set([
    ...declared(own),
    ...declared(await manifest(join(workspace, "package.json"))),
  ]);
  const packages = [
    ...new Set(imported.flatMap((specifier) => packageOf(specifier) ?? [])),
  ].filter((name) => !known.has(name));
  return { directory: relative(workspace, directory), packages };
}
