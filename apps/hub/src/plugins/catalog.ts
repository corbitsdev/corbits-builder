import { resolve } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPlugin,
  readPluginFolder,
} from "@corbits-builder/plugin-host/folder";
import {
  WORKFLOW_PACKAGES,
  WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";
import { ModelRole } from "@corbits-builder/schemas/models";
import { sharedRoles, type AgentRole } from "../inference/model-limits.ts";

// From this file rather than the working directory, so every way of starting the hub finds them.
const HUB_FOLDER = resolve(import.meta.dir, "../..");
const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

// The coordinator and reviewer live in the hub, and stored profiles name the model settings, so the
// hub's own package.json declares them in the same builder block a plugin uses.
const CATALOG = await loadCatalog([
  await readPlugin(HUB_FOLDER),
  ...(await readPluginFolder(PLUGINS_FOLDER)),
]);

// Stored records name every role and model setting their schemas know, so each must be declared.
function declaresAll(
  what: string,
  declared: readonly string[],
  known: { select(kind: "unit"): readonly { unit: unknown }[] },
) {
  const missing = known
    .select("unit")
    .map(({ unit }) => String(unit))
    .filter((name) => !declared.includes(name));
  if (missing.length > 0)
    throw new Error(`No plugin declares ${what} ${missing.join(", ")}`);
}

const isBudget = (name: string): name is AgentRole =>
  Object.hasOwn(sharedRoles, name);

export const ROLES = [...CATALOG.roles.values()].map(({ role, setting }) => {
  if (!isBudget(role.limits))
    throw new Error(
      `The role ${role.name} has limits ${role.limits}, no budget`,
    );
  return {
    name: WorkflowRole.assert(role.name),
    setting: ModelRole.assert(role.model),
    tier: setting.tier,
    limits: role.limits,
  };
});
declaresAll(
  "the role",
  ROLES.map(({ name }) => name),
  WorkflowRole,
);

/** Every model setting, in the order Settings lists them. */
export const SETTINGS = [...CATALOG.settings].map(
  ([id, { label, hint, tier }]) => ({
    id: ModelRole.assert(id),
    label,
    hint,
    tier,
  }),
);
declaresAll(
  "the model setting",
  SETTINGS.map(({ id }) => id),
  ModelRole,
);

for (const name of CATALOG.packages.keys())
  if (!Object.hasOwn(WORKFLOW_PACKAGES, name))
    throw new Error(`${name} is not a workflow package the hub installs`);

export function packageEntry(name: string): string {
  const entry = CATALOG.packages.get(name);
  if (entry === undefined)
    throw new Error(`No plugin declares the workflow package ${name}`);
  return entry;
}
