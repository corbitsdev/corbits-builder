import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { hasCode } from "@intx/types";
import { rgPath } from "@vscode/ripgrep";

// Resolve with Bun's installed package graph; source closures and npm installs
// can place the same dependency outside the importing package's node_modules.
async function packageRoot(name: string, from: string) {
  let directory = dirname(await realpath(Bun.resolveSync(name, from)));
  for (;;) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (manifest.name === name) return { directory, manifest };
    } catch (error) {
      if (!(hasCode(error) && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("build_dependency_manifest_missing");
    directory = parent;
  }
}

// The package exports only its library entry; its CLI sits beside package.json.
export const browserCli = () =>
  join(
    dirname(
      createRequire(import.meta.url).resolve("@playwright/mcp/package.json"),
    ),
    "cli.js",
  );

export async function buildPackageLayout() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const childPath = await realpath(resolve(directory, "posix-child.ts"));
  const roots = new Set<string>();
  const pending: [string, string][] = [
    ["@anthropic-ai/sandbox-runtime", directory],
    ["@intx/tools-posix", directory],
    ["@playwright/mcp", directory],
    ["arktype", directory],
  ];
  let runtimeVersion = "";
  for (const [name, from] of pending) {
    const entry = await packageRoot(name, from);
    if (name === "@anthropic-ai/sandbox-runtime")
      runtimeVersion = String(entry.manifest.version);
    const known = roots.has(entry.directory);
    roots.add(entry.directory);
    // Keep the installed lookup links visible too: resolving only real package
    // roots would hide home-directory node_modules links inside the sandbox.
    const lookup =
      createRequire(join(from, "package.json")).resolve.paths(name) ?? [];
    for (const path of lookup) {
      try {
        if ((await realpath(join(path, name))) === entry.directory)
          roots.add(await realpath(path));
      } catch (error) {
        if (!(hasCode(error) && error.code === "ENOENT")) throw error;
      }
    }
    if (known) continue;
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {}))
      pending.push([dependency, entry.directory]);
  }
  // The run-child env carries no PATH (workflow-host supervisor/spawn-env.ts),
  // so the hub hands over the installed binary instead of a host lookup.
  const ripgrepPath = await realpath(rgPath);
  return {
    assetDirectory: await realpath(directory),
    browserCli: await realpath(browserCli()),
    childPath,
    dependencyRoots: [...roots],
    ripgrepPath,
    runtimeVersion,
  };
}
