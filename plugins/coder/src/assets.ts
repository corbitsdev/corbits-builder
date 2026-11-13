import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import manifest from "../package.json";

// Bun macros: they run when the coder bundle is built, so the check scripts and the kit digest ship
// inside the workflow package instead of being looked up on the machine that runs it.

const CHECK = join(import.meta.dir, "..", "check");

// The check commands by name, from check/<command>.ts: check-stack, every coder's finish check,
// and check-app, which a web app's CHECKS.txt runs and the designer's check_design runs.
export const checkScripts = (): Record<string, string> =>
  Object.fromEntries(
    ["check-stack", "check-app"].map((check) => [
      check,
      readFileSync(join(CHECK, `${check}.ts`), "utf8"),
    ]),
  );

// The module the checks share, by the path they import it from once each is compiled on its own.
export const checkModules = (): Record<string, string> => ({
  "/steps.ts": readFileSync(join(CHECK, "steps.ts"), "utf8"),
});

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
// installed type file. The installed kit must be the version the web app starter pins.
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
      join(
        import.meta.dir,
        "..",
        manifest.builder.appStarters["web-app"].folder,
        "client",
        "package.json",
      ),
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
