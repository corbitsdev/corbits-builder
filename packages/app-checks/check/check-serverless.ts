// check-serverless: whether the app's worker runs on a host with no disk and no long-running
// process. It bundles the worker's code for a browser-like runtime and fails, naming each file,
// when the code imports the local disk or processes, imports a module made for Bun or a Node
// server, uses the Bun global, or listens on a port. What a serverless host lacks is the same for
// every vendor, but what each host provides differs. So the app's line in BUILDER-CHECKS.txt names
// the worker's entry (its source, or the built module whose linked source map leads back to it),
// then each module scheme the host provides, such as cloudflare:, as the pack for that host says.
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const USAGE = "check-serverless <entry> [<scheme:>...]";

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    `${USAGE}   check that the worker whose entry, or built module, is named runs with no disk, no Bun and no port; modules of each scheme named, such as cloudflare:, are the host's own`,
  );
  process.exit(0);
}

const fail = (lines: readonly string[]): never => {
  console.log(
    ["check failed: the worker does not fit a serverless host", ...lines].join(
      "\n",
    ),
  );
  process.exit(1);
};

// A source map as a bundler writes it: the source paths, relative to the map, and their text when
// the map includes it. The app's build wrote the map, so sourceMapOf checks its shape.
type SourceMap = { sources: string[]; sourcesContent: (string | null)[] };
function sourceMapOf(value: unknown): SourceMap | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const sources = "sources" in value ? value.sources : undefined;
  const content = "sourcesContent" in value ? value.sourcesContent : [];
  if (
    !Array.isArray(sources) ||
    !sources.every((source) => typeof source === "string") ||
    !Array.isArray(content) ||
    !content.every((text) => typeof text === "string" || text === null)
  )
    return undefined;
  return { sources, sourcesContent: content };
}

const named = process.argv[2];
if (named === undefined || named === "")
  fail([
    `name the worker's entry, as a line of BUILDER-CHECKS.txt does: ${USAGE}, such as check-serverless server/dist/worker.js`,
  ]);
const entryOf = async (built: string) => {
  if ([".ts", ".tsx", ".mts"].includes(extname(built))) return built;
  if (!(await Bun.file(built).exists()))
    return fail([
      `${built} does not exist: bun run build makes it, so run it first`,
    ]);
  const file = Bun.file(`${built}.map`);
  if (!(await file.exists()))
    return fail([
      `${built} has no ${basename(built)}.map beside it: build the worker with --sourcemap=linked, so this check finds the source it was built from`,
    ]);
  const read = sourceMapOf(await file.json().catch(() => undefined));
  if (read === undefined)
    return fail([`${built}.map is not a source map naming its sources`]);
  const wanted = basename(built, extname(built));
  const source = read.sources
    .map((path) => resolve(dirname(built), path))
    .find(
      (path) =>
        !path.includes("/node_modules/") &&
        basename(path, extname(path)) === wanted,
    );
  return (
    source ??
    fail([
      `${built}.map names no source called ${wanted}: the worker's entry and its built module share a name, as src/worker.ts builds dist/worker.js`,
    ])
  );
};
const entry = await entryOf(String(named));

// Modules that reach the disk or other processes, or exist only on Bun or a Node server.
const FORBIDDEN =
  /^(?:node:)?(?:fs|fs\/promises|child_process|worker_threads|cluster)$|^bun(?::.*)?$|^hono\/bun$|^@hono\/node-server(?:\/.*)?$/;
// The host provides Node's other modules through its Node compatibility, and its own modules under
// the schemes the app's line names.
const schemes = process.argv.slice(3);
const unnamed = schemes.find((scheme) => !/^[a-z][a-z0-9+.-]*:$/.test(scheme));
if (unnamed !== undefined)
  fail([
    `${unnamed} is not a module scheme such as cloudflare:, as ${USAGE} takes after the entry`,
  ]);
const PROVIDED = new RegExp(
  `^(?:${["node:", ...schemes].map((scheme) => `${scheme.replace(/[.+]/g, "\\$&")}.*`).join("|")})$`,
);

const shown = (path: string) => relative(process.cwd(), path) || path;
const problems: string[] = [];
const built = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "esm",
  sourcemap: "external",
  throw: false,
  plugins: [
    {
      name: "serverless",
      setup(build) {
        build.onResolve({ filter: FORBIDDEN }, ({ path, importer }) => {
          problems.push(`${shown(importer)} imports ${path}`);
          return { path, external: true };
        });
        build.onResolve({ filter: PROVIDED }, ({ path }) => ({
          path,
          external: true,
        }));
      },
    },
  ],
});
if (!built.success)
  fail([
    `${shown(entry)} does not bundle for a browser-like runtime:`,
    ...built.logs.map((log) => `  ${String(log.message ?? log)}`),
  ]);

// Only the app's code is scanned, as bundled; packages may test for Bun before they use it.
const map = built.outputs.find((output) => output.kind === "sourcemap");
const { sources, sourcesContent } = (map && sourceMapOf(await map.json())) ?? {
  sources: [],
  sourcesContent: [],
};
const GLOBALS: [RegExp, string][] = [
  [/\bBun\.\w+/, "uses the Bun global"],
  [/\.listen\s*\(|\bcreateServer\s*\(/, "listens on a port"],
];
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
for (const [index, source] of sources.entries()) {
  if (source.includes("node_modules/")) continue;
  const path = map ? join(dirname(map.path), source) : source;
  const lines = withoutComments(sourcesContent[index] ?? "").split("\n");
  for (const [line, text] of lines.entries())
    for (const [pattern, what] of GLOBALS) {
      const found = text.match(pattern);
      if (found)
        problems.push(
          `${shown(resolve(path))}:${line + 1} ${what} (${found[0]})`,
        );
    }
}

if (problems.length > 0)
  fail([
    ...[...new Set(problems)].map((problem) => `✗ ${problem}`),
    "A serverless host has no disk and no process of the app's own: keep data in the host's database through the storage module, leave static files to the host, and let the worker's entry answer requests through its exported fetch.",
  ]);
console.log(
  `check passed: ${shown(entry)} bundles for a browser-like runtime with no disk, no Bun and no port`,
);
