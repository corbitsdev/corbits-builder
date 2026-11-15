import { join, relative, resolve } from "node:path";
import { type } from "arktype";
import { Builder, type ModelSetting, type Role } from "@corbits-builder/plugin";
import type { Found } from "./folder.ts";

const Manifest = type({ name: "string > 0", builder: Builder });

// Each name is declared by one plugin only, so no plugin's runs pass for another's.
export type Catalog = {
  roles: ReadonlyMap<string, { role: Role; setting: ModelSetting }>;
  settings: ReadonlyMap<string, ModelSetting>;
  packages: ReadonlyMap<string, string>;
};

export async function loadCatalog(found: readonly Found[]): Promise<Catalog> {
  const roles = new Map<string, Role>();
  const settings = new Map<string, ModelSetting>();
  const packages = new Map<string, string>();
  const declaredBy = new Map<string, string>();
  function declare<T>(
    into: Map<string, T>,
    what: string,
    plugin: string,
    name: string,
    value: T,
  ) {
    const earlier = declaredBy.get(`${what} ${name}`);
    if (earlier)
      throw new Error(
        `${plugin} declares ${what} ${name}, which ${earlier} already declares`,
      );
    declaredBy.set(`${what} ${name}`, plugin);
    into.set(name, value);
  }
  for (const { root, manifest } of found) {
    const checked = Manifest(manifest);
    if (checked instanceof type.errors)
      throw new Error(`${join(root, "package.json")}: ${checked.summary}`);
    const { name, builder } = checked;
    for (const role of builder.roles)
      declare(roles, "the role", name, role.name, role);
    if (builder.settings)
      for (const [setting, declared] of Object.entries(builder.settings))
        declare(settings, "the model setting", name, setting, declared);
    for (const [pkg, { entry }] of Object.entries(builder.packages)) {
      const path = resolve(root, entry);
      if (relative(root, path).startsWith(".."))
        throw new Error(
          `${name}'s package ${pkg} has its entry outside the plugin, at ${entry}`,
        );
      if (!(await Bun.file(path).exists()))
        throw new Error(`${name}'s package ${pkg} has no entry at ${entry}`);
      declare(packages, "the workflow package", name, pkg, path);
    }
  }
  const running = new Map<string, { role: Role; setting: ModelSetting }>();
  for (const role of roles.values()) {
    const setting = settings.get(role.model);
    if (!setting)
      throw new Error(
        `The role ${role.name} runs on ${role.model}, a model setting no plugin declares`,
      );
    running.set(role.name, { role, setting });
  }
  return { roles: running, settings, packages };
}
