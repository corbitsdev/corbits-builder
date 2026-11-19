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
import type { Role } from "@corbits-builder/plugin";
import { PREFERENCES } from "../config/preferences.ts";
import type { Actor } from "../lib/actor.ts";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import {
  COORDINATOR,
  COORDINATOR_BUDGET,
  COORDINATOR_SETTING,
} from "../workflows/coordinator-role.ts";
import { FACTS } from "./facts.ts";

export {
  isReadyPlan,
  isWorkflowAction,
} from "@corbits-builder/plugin-host/catalog";

// From this file rather than the working directory, so every way of starting the hub finds it.
export const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

// All the plugins need from the hub: the facts it works out, the preferences a screen's answer may
// set, and the model setting and output budget of its own coordinator.
export const HOST: Host = {
  facts: FACTS,
  preferences: new Set(PREFERENCES.map(({ id }) => id)),
  settings: new Map([[COORDINATOR.model, COORDINATOR_SETTING]]),
  budgets: new Map([[COORDINATOR.limits, COORDINATOR_BUDGET]]),
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

// The catalog as the project sees it, with the plugins its selections name.
export const catalogOf = async (
  projectState: (actor: Actor, projectId: string) => Promise<ProjectState>,
  actor: Actor,
  projectId: string,
) => {
  const state = await projectState(actor, projectId);
  return projectCatalog(async (names) =>
    readProjectValues(names, state, CATALOG.values),
  );
};

/**
 * The calling specialist run and the installed action it was started for, as the project sees the
 * catalog; with live, only while the run is running. The action is undefined once it is no longer
 * installed, so the run is given nothing in that action's name.
 */
export async function callingAction(
  artifacts: {
    actionRun: (
      actor: Actor,
      projectId: string,
      live: boolean,
    ) => Promise<{ plugin: string; action: string }>;
    projectState: (actor: Actor, projectId: string) => Promise<ProjectState>;
  },
  actor: Actor,
  projectId: string,
  live = false,
) {
  const run = await artifacts.actionRun(actor, projectId, live);
  const action = (
    await catalogOf(artifacts.projectState, actor, projectId)
  ).actions
    .filter(isWorkflowAction)
    .find(
      (installed) =>
        installed.plugin === run.plugin && installed.action === run.action,
    );
  return { run, action };
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

/**
 * The role a run plays, by name: the coordinator's, else the one an installed plugin declares. Only
 * names a run was recognised by, or an installed package plays, are asked for.
 */
export function runRole(name: string) {
  const role = name === COORDINATOR.name ? COORDINATOR : CATALOG.role(name);
  if (!role) throw new Error(`role_unknown:${name}`);
  return role;
}

/** The model setting a role runs on, its tier and the output budget it runs with, as declared. */
export function roleModel(role: Pick<Role, "model" | "limits">) {
  const setting = CATALOG.settings.get(role.model);
  if (!setting) throw new Error(`model_setting_unknown:${role.model}`);
  const budget = CATALOG.budgets.get(role.limits);
  if (!budget) throw new Error(`model_budget_unknown:${role.limits}`);
  return { setting: role.model, tier: setting.tier, budget };
}

// Every workflow package Builder installs and the name of the role its runs play: the hub's
// coordinator and each package a plugin brings.
export const WORKFLOW_PACKAGES: ReadonlyMap<string, string> = new Map([
  [COORDINATOR.name, COORDINATOR.name],
  ...[...CATALOG.packages].map(([name, { role }]) => [name, role] as const),
]);
export const SCREENS = CATALOG.screens;
// The specialists that have screens, which the hub's plugin hint names.
export const WITH_SCREENS = PLUGINS.filter(
  (plugin) =>
    isSpecialist(plugin) &&
    SCREENS.some((screen) => screen.plugin === plugin.builder.handle),
);

// The ready-made plans a project is following, as the hub stores them: their handles.
export const ProjectFollowing = type({
  "+": "reject",
  following: type("string > 0").array(),
});
