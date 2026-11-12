import { resolve } from "node:path";
import { type } from "arktype";
import {
  isSpecialist,
  isWorkflowAction,
  loadCatalog,
  type Host,
} from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { TOKEN_DECLARATIONS } from "../artifacts/project-values.ts";
import { FACTS } from "./facts.ts";

export {
  isRoute,
  isWorkflowAction,
} from "@corbits-builder/plugin-host/catalog";

// From this file rather than the working directory, so every way of starting the hub finds it.
export const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

// All the plugins need from the hub: the facts it works out and the project values it keeps in the
// design's tokens.
export const HOST: Host = {
  facts: FACTS,
  values: TOKEN_DECLARATIONS,
};

// Every plugin in the folder, checked once when the hub loads; a wrong one stops the hub.
export const CATALOG = await loadCatalog(
  await readPluginFolder(PLUGINS_FOLDER),
  HOST,
);
export const PLUGINS = CATALOG.plugins;
export const SCREENS = CATALOG.screens;
// The specialists that have screens, which is all the classic coordinator finds.
export const WITH_SCREENS = PLUGINS.filter(
  (plugin) =>
    isSpecialist(plugin) &&
    SCREENS.some((screen) => screen.plugin === plugin.builder.handle),
);

/**
 * What a finished run of an installed workflow tells the coordinator about the screens that show
 * its work, from the action that starts it; null when that action presents nothing.
 */
export function presentsFor(workflow: string) {
  const starting = CATALOG.actions
    .filter(isWorkflowAction)
    .filter(({ builder }) => builder.start.workflow === workflow);
  const presents = new Set(starting.map(({ presents }) => presents));
  if (presents.size > 1)
    throw new Error(
      `${starting.map(({ name }) => name).join(", ")} start ${workflow} but present different screens`,
    );
  return starting[0]?.presents ?? null;
}

// The routes a project follows, as the hub stores them: route plugins' handles.
export const ProjectRoutes = type({
  "+": "reject",
  routes: type("string > 0").array(),
});
