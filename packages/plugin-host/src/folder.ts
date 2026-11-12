import { dirname, join, resolve } from "node:path";

/** A plugin's folder as found, before its manifest is checked. */
export type Found = {
  // The folder's name under plugins, which errors name until the manifest is checked.
  folder: string;
  manifest: unknown;
  // The default export of a module the manifest names, by its path there.
  module(path: string): Promise<unknown>;
  // A text file the manifest names, by its path there.
  text(path: string): Promise<string>;
};

const hasBuilder = (manifest: unknown) =>
  typeof manifest === "object" && manifest !== null && "builder" in manifest;

/**
 * Every folder under plugins whose package.json has a builder block, in folder order. A bundle
 * cannot read a folder when it runs, so bundle.ts swaps this module for one built from the same folder.
 */
export async function readPluginFolder(plugins: string): Promise<Found[]> {
  const paths = [
    ...new Bun.Glob("*/package.json").scanSync({ cwd: plugins }),
  ].sort();
  const found = await Promise.all(
    paths.map(async (path) => {
      const folder = dirname(path);
      const root = join(plugins, folder);
      const manifest: unknown = await Bun.file(join(plugins, path)).json();
      return {
        folder,
        manifest,
        module: async (named: string) =>
          (await import(resolve(root, named))).default,
        text: (named: string) => Bun.file(resolve(root, named)).text(),
      };
    }),
  );
  return found.filter(({ manifest }) => hasBuilder(manifest));
}
