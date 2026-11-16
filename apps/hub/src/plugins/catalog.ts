import { resolve } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPlugin,
  readPluginFolder,
} from "@corbits-builder/plugin-host/folder";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { sharedRoles, type AgentRole } from "../inference/model-limits.ts";
import { PREFERENCES } from "../config/preferences.ts";
import { PROFILES } from "../config/models.ts";
import type { RoleTiers } from "@corbits-builder/schemas/models";

// From this file rather than the working directory, so every way of starting the hub finds them.
const HUB_FOLDER = resolve(import.meta.dir, "../..");
const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

export const catalog = await loadCatalog(
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

for (const { role } of catalog.roles.values()) {
  if (!isBudget(role.limits))
    throw new Error(
      `The role ${role.name} has limits ${role.limits}, no budget`,
    );
}

export function roleOf(name: WorkflowRole) {
  const found = catalog.roles.get(name);
  if (!found) throw new Error(`No plugin declares the role ${name}`);
  return found.role;
}

export const undeclaredSetting = (roleTiers: RoleTiers | undefined) =>
  roleTiers && Object.keys(roleTiers).find((id) => !catalog.settings.has(id));

for (const { id, roleTiers } of PROFILES) {
  const undeclared = undeclaredSetting(roleTiers);
  if (undeclared)
    throw new Error(`The profile ${id} names ${undeclared}, no model setting`);
}
