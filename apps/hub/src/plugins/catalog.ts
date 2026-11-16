import { resolve } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPlugin,
  readPluginFolder,
} from "@corbits-builder/plugin-host/folder";
import { sharedRoles, type AgentRole } from "../inference/model-limits.ts";
import { PREFERENCES } from "../config/preferences.ts";
import { PROFILES } from "../config/models.ts";
import type { RoleTiers } from "@corbits-builder/schemas/models";

// From this file rather than the working directory, so every way of starting the hub finds them.
const HUB_FOLDER = resolve(import.meta.dir, "../..");
const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

export const CATALOG = await loadCatalog(
  [await readPlugin(HUB_FOLDER), ...(await readPluginFolder(PLUGINS_FOLDER))],
  new Set(
    PREFERENCES.filter(
      ({ options }) =>
        options.length === 2 &&
        options.some(({ id }) => id === "yes") &&
        options.some(({ id }) => id === "no"),
    ).map(({ id }) => id),
  ),
);

const isBudget = (name: string): name is AgentRole =>
  Object.hasOwn(sharedRoles, name);

for (const role of CATALOG.roles) {
  if (!isBudget(role.limits))
    throw new Error(
      `The role ${role.name} has limits ${role.limits}, no budget`,
    );
}

/** The role a run plays, by name, as the plugin that declares it says. */
export function runRole(name: string) {
  const role = CATALOG.role(name);
  if (!role) throw new Error(`role_unknown:${name}`);
  return role;
}

/** The model setting a role runs on and its tier, as declared. */
export function roleModel(role: { model: string }) {
  const setting = CATALOG.settings.get(role.model);
  if (!setting) throw new Error(`model_setting_unknown:${role.model}`);
  return { setting: role.model, tier: setting.tier };
}

// Every workflow package Builder installs and the name of the role its runs play.
export const WORKFLOW_PACKAGES: ReadonlyMap<string, string> = new Map(
  [...CATALOG.packages].map(([name, { role }]) => [name, role] as const),
);

export const undeclaredSetting = (roleTiers: RoleTiers | undefined) =>
  roleTiers && Object.keys(roleTiers).find((id) => !CATALOG.settings.has(id));

for (const { id, roleTiers } of PROFILES) {
  const undeclared = undeclaredSetting(roleTiers);
  if (undeclared)
    throw new Error(`The profile ${id} names ${undeclared}, no model setting`);
}
