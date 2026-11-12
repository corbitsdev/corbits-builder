import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Bun macros: they run when the coder bundle is built, so the starter app and the check script
// ship inside the workflow package instead of being looked up on the machine that runs it.

const files = (root: string, directory = root): [string, string][] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== "dist")
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(root, join(directory, entry.name))
        : [
            [
              relative(root, join(directory, entry.name)),
              readFileSync(join(directory, entry.name), "utf8"),
            ],
          ],
    );

export const starterFiles = (): Record<string, string> =>
  Object.fromEntries(
    files(join(import.meta.dir, "..", "starter")).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );

export const checkScript = (): string =>
  readFileSync(join(import.meta.dir, "..", "check", "check-app.ts"), "utf8");

export const watchScript = (): string =>
  readFileSync(join(import.meta.dir, "..", "check", "watch-page.ts"), "utf8");

const KIT = "@corbits/react-ui";

const declarations = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^import\b[\s\S]*?;$/gm, "")
    .replace(/^export \{\};$/gm, "")
    .replace(/import\("[^"]+"\)\./g, "")
    .replace(/\b(declare|readonly) /g, "")
    .replace(/ = "[^"]{80,}";/g, ": string;")
    .replace(/\(\{[^{}]*\}: /g, "(props: ")
    .replace(/\): (React\.)?JSX\.Element;/g, ");")
    .replace(/^( {4})+/gm, (indent) => "  ".repeat(indent.length / 4))
    .replace(/\n\s*\n/g, "\n")
    .trim();

// Every public @corbits/react-ui component module, under the path it is imported from, with its
// declarations stripped of comments and imports: exact props in one file instead of a read of each
// installed type file. The installed kit must be the version the starter pins.
export const kitDigest = (): string => {
  const root = join(
    Bun.resolveSync(`${KIT}/package.json`, import.meta.dir),
    "..",
  );
  const kit = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
    exports: Record<string, string | { types?: string }>;
  };
  const starter = JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "starter", "client", "package.json"),
      "utf8",
    ),
  ) as { dependencies: Record<string, string> };
  if (starter.dependencies[KIT] !== kit.version)
    throw new Error(
      `${KIT} ${kit.version} is installed but the starter pins ${starter.dependencies[KIT]}`,
    );
  const dist = join(root, "dist");
  const modules: [string, string][] = [
    ...[
      ...readFileSync(join(dist, "index.d.ts"), "utf8").matchAll(
        /"\.\/(.+)\.js"/g,
      ),
    ].map(([, module]): [string, string] => [`${module}.d.ts`, KIT]),
    ...Object.entries(kit.exports).flatMap(
      ([path, target]): [string, string][] =>
        typeof target === "object" && target.types && path !== "."
          ? [
              [
                relative(dist, join(root, target.types)),
                `${KIT}/${path.slice(2)}`,
              ],
            ]
          : [],
    ),
  ].filter(
    ([module]) => module.startsWith("ui/") || module.startsWith("blocks/"),
  );
  const sections = modules.map(
    ([module, from]) =>
      `## ${module.replace(/\.d\.ts$/, "")}, from "${from}"\n${declarations(readFileSync(join(dist, module), "utf8"))}`,
  );
  return `# ${KIT} ${kit.version} components\n\n${sections.join("\n\n")}\n`;
};
