import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type } from "arktype";
import manifest from "../package.json";

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

const KitPackage = type({
  version: "string",
  exports: { "[string]": type("string").or({ "types?": "string" }) },
});
const PinsKit = type({ dependencies: { [KIT]: "string" } });

// Every public @corbits/react-ui component module, under the path it is imported from, with its
// declarations stripped of comments and imports: exact props in one file instead of a read of each
// installed type file. The installed kit must be the version the web app starter pins.
export const kitDigest = (): string => {
  const root = join(
    Bun.resolveSync(`${KIT}/package.json`, import.meta.dir),
    "..",
  );
  const kit = KitPackage.assert(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
  );
  const starter = PinsKit.assert(
    JSON.parse(
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
    ),
  );
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
