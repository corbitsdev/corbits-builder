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

// The coordinator and reviewer live in the hub, and stored profiles name the model settings, so the
// hub's own package.json declares them in the same builder block a plugin uses.
const CATALOG = await loadCatalog([
  await readPlugin(HUB_FOLDER),
  ...(await readPluginFolder(PLUGINS_FOLDER)),
]);

const isBudget = (name: string): name is AgentRole =>
  Object.hasOwn(sharedRoles, name);

export const ROLES = [...CATALOG.roles.values()].map(({ role, setting }) => {
  if (!isBudget(role.limits))
    throw new Error(
      `The role ${role.name} has limits ${role.limits}, no budget`,
    );
  return {
    name: role.name,
    setting: role.model,
    tier: setting.tier,
    limits: role.limits,
    called: role.called,
    ended: role.ended,
  };
});

/** The declared role of the name, read from a stored or incoming record. */
export function roleOf(name: WorkflowRole) {
  const role = ROLES.find((each) => each.name === name);
  if (!role) throw new Error(`No plugin declares the role ${name}`);
  return role;
}

/** Every model setting, in the order Settings lists them. */
export const SETTINGS = [...CATALOG.settings].map(
  ([id, { label, hint, tier }]) => ({ id, label, hint, tier }),
);

/** The model setting a stored or incoming profile names, when no plugin declares it. */
export const undeclaredSetting = (roleTiers: RoleTiers | undefined) =>
  roleTiers && Object.keys(roleTiers).find((id) => !CATALOG.settings.has(id));

for (const { id, roleTiers } of PROFILES) {
  const undeclared = undeclaredSetting(roleTiers);
  if (undeclared)
    throw new Error(`The profile ${id} names ${undeclared}, no model setting`);
}

/** Every workflow package the hub installs, in the order the plugins declare them. */
export const PACKAGES = [...CATALOG.packages].map(
  ([name, { path, declared }]) => {
    const when = declared.replaces?.when;
    if (when !== undefined && !PREFERENCES.some(({ id }) => id === when))
      throw new Error(
        `The package ${name} replaces while ${when}, no preference`,
      );
    return {
      name,
      entry: path,
      role: declared.role,
      files: declared.files,
      replaces: declared.replaces,
    };
  },
);
