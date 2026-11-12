import { resolve } from "node:path";
import { type } from "arktype";
import {
  isSpecialist,
  isWorkflowAction,
  loadCatalog,
  type Host,
} from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import {
  SpawnedRole,
  type WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import { TOKEN_DECLARATIONS } from "../artifacts/project-values.ts";
import { PREFERENCES } from "../config/preferences.ts";
import { FACTS } from "./facts.ts";

export {
  isRoute,
  isWorkflowAction,
} from "@corbits-builder/plugin-host/catalog";

// From this file rather than the working directory, so every way of starting the hub finds it.
export const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

// All the plugins need from the hub: the facts it works out, the project values it keeps in the
// design's tokens and the preferences a screen's answer may set.
export const HOST: Host = {
  facts: FACTS,
  values: TOKEN_DECLARATIONS,
  preferences: new Set(PREFERENCES.map(({ id }) => id)),
};

// Every plugin in the folder, checked once when the hub loads; a wrong one stops the hub.
export const CATALOG = await loadCatalog(
  await readPluginFolder(PLUGINS_FOLDER),
  HOST,
);
export const PLUGINS = CATALOG.plugins;
// Every workflow package Builder installs and the role its runs play: the hub's coordinator and each
// package a plugin brings. A role is what picks a run's model, guidance and wording, so a plugin
// naming one Builder does not know stops the hub.
export const WORKFLOW_PACKAGES: ReadonlyMap<string, WorkflowRole> = new Map([
  ["coordinator", "coordinator"],
  ["presenter", "presenter"],
  ...[...CATALOG.packages].map(
    ([name, { role }]) => [name, SpawnedRole.assert(role)] as const,
  ),
]);
export const SCREENS = CATALOG.screens;
// The specialists that have screens, which the hub's plugin hint names.
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
