import { resolve } from "node:path";
import { type } from "arktype";
import {
  isSpecialist,
  isWorkflowAction,
  loadCatalog,
  selectionName,
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
  isReadyPlan,
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

// The project values that select, of each handle several plugins share, the one a project uses.
const SELECTIONS = CATALOG.choices.map(({ handle }) => selectionName(handle));

/**
 * The catalog as one project sees it, from its values read by name: of each handle several plugins
 * share, the one the person selected, else the default. Everything that acts on a project resolves
 * plugins through it.
 */
export async function projectCatalog(
  read: (
    names: readonly string[],
  ) => Promise<Readonly<Record<string, unknown>>>,
) {
  // The hub refuses a read of no names.
  return CATALOG.select(SELECTIONS.length === 0 ? {} : await read(SELECTIONS));
}

/** Whether a project value is the selection of one of the plugins sharing a handle. */
export const isSelection = (name: string) => SELECTIONS.includes(name);

/**
 * Why a value cannot be saved as a selection, which names a package installed with that handle;
 * undefined when it can, or when the name is no selection.
 */
export function selectionRefusal(name: string, value: unknown) {
  const choice = CATALOG.choices.find(
    ({ handle }) => selectionName(handle) === name,
  );
  if (!choice) return undefined;
  const packages = [choice.using, ...choice.others].map(
    (plugin) => plugin.package,
  );
  return packages.some((each) => each === value)
    ? undefined
    : `is not an installed ${choice.handle} plugin: ${packages.join(" or ")}`;
}
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
    .filter((action) => action.workflow === workflow);
  const presents = new Set(starting.map(({ presents }) => presents));
  if (presents.size > 1)
    throw new Error(
      `${starting.map(({ name }) => name).join(", ")} start ${workflow} but present different screens`,
    );
  return starting[0]?.presents ?? null;
}

// The ready-made plans a project is following, as the hub stores them: their handles.
export const ProjectFollowing = type({
  "+": "reject",
  following: type("string > 0").array(),
});
