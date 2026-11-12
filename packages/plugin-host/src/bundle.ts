import { resolve } from "node:path";
import type { BunPlugin } from "bun";
import { manifestFiles } from "./catalog.ts";
import { readPluginFolder } from "./folder.ts";

const json = (value: unknown) => JSON.stringify(value);

// folder.ts as a bundle needs it: every file the folder's manifests name, imported or inlined.
async function bundledFolder(plugins: string) {
  const imports: string[] = [];
  const entries: string[] = [];
  for (const found of await readPluginFolder(plugins)) {
    const { modules, texts } = manifestFiles(found);
    const imported = modules.map((path) => {
      const name = `module${imports.length}`;
      imports.push(
        `import * as ${name} from ${json(resolve(plugins, found.folder, path))};`,
      );
      return `${json(path)}: ${name}.default`;
    });
    const inlined = await Promise.all(
      texts.map(
        async (path) => `${json(path)}: ${json(await found.text(path))}`,
      ),
    );
    entries.push(
      `{ folder: ${json(found.folder)}, manifest: ${json(found.manifest)}, modules: { ${imported.join(", ")} }, texts: { ${inlined.join(", ")} } }`,
    );
  }
  return [
    ...imports,
    `const folders = [${entries.join(", ")}];`,
    `const named = (folder, files, path) => {`,
    `  if (!Object.hasOwn(files, path)) throw new Error(\`plugins/\${folder} names \${path}, which was not bundled\`);`,
    `  return files[path];`,
    `};`,
    `export const readPluginFolder = async () =>`,
    `  folders.map(({ folder, manifest, modules, texts }) => ({`,
    `    folder,`,
    `    manifest,`,
    `    module: async (path) => named(folder, modules, path),`,
    `    text: async (path) => named(folder, texts, path),`,
    `  }));`,
  ].join("\n");
}

/** A Bun.build plugin that bundles the plugins folder in place of reading it when the bundle runs. */
export const bundledPlugins = (plugins: string): BunPlugin => ({
  name: "builder-plugins",
  setup(build) {
    build.onLoad(
      { filter: /\/packages\/plugin-host\/src\/folder\.ts$/ },
      async () => ({ loader: "js", contents: await bundledFolder(plugins) }),
    );
  },
});
