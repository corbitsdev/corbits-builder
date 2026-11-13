/**
 * The installed plugins' roles, as the app entry installs them from the bundled manifests, for
 * tests that read a run's role. Importing this module installs them.
 */
import { installRoles } from "./roles.ts";

const plugins = new URL("../../../../../plugins/", import.meta.url).pathname;

installRoles(
  Object.fromEntries(
    await Promise.all(
      [...new Bun.Glob("*/package.json").scanSync(plugins)].map(
        async (path) => [path, await Bun.file(plugins + path).json()] as const,
      ),
    ),
  ),
);
