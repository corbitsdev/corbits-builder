/**
 * The installed plugins' roles, as the app entry installs them from the bundled manifests and
 * action definitions, for tests that read a run's role or an action's words. Importing this module
 * installs them.
 */
import { installRoles } from "./roles.ts";

const plugins = new URL("../../../../../plugins/", import.meta.url).pathname;

// Each file the glob finds under the plugins folder, by its full path, as loaded.
async function each<Loaded>(
  glob: string,
  load: (path: string) => Promise<Loaded>,
): Promise<Record<string, Loaded>> {
  return Object.fromEntries(
    await Promise.all(
      [...new Bun.Glob(glob).scanSync(plugins)].map(
        async (path) => [plugins + path, await load(plugins + path)] as const,
      ),
    ),
  );
}

installRoles({
  manifests: await each("*/package.json", (path) => Bun.file(path).json()),
  definitions: await each(
    "*/src/*/definition.ts",
    async (path) => (await import(path)).default,
  ),
});
