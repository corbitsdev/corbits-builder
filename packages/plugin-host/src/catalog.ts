import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type } from "arktype";
import {
  Builder,
  type ModelSetting,
  type Role,
  type WorkflowPackage,
} from "@corbits-builder/plugin";
import type { Found } from "./folder.ts";

const Manifest = type({ name: "string > 0", builder: Builder });

// A workflow package a plugin brings: the role its runs play and its entry's real path.
export type PluginPackage = { role: string; entry: string };

export type Catalog = {
  // Each workflow package a plugin brings, by name.
  packages: ReadonlyMap<string, PluginPackage>;
  // Every role the plugins declare, and one of them by name.
  roles: readonly Role[];
  role(name: string): Role | undefined;
  settings: ReadonlyMap<string, ModelSetting>;
  filers: ReadonlyMap<string, string>;
  substitutions: ReadonlyMap<string, { package: string; when: string }>;
  // The older name a package is also scoped under, by package name.
  aliases: ReadonlyMap<string, string>;
};

export async function loadCatalog(
  found: readonly Found[],
  booleanPreferences: ReadonlySet<string>,
): Promise<Catalog> {
  const roles = new Map<string, Role>();
  const settings = new Map<string, ModelSetting>();
  const declarations = new Map<string, WorkflowPackage>();
  const packages = new Map<string, PluginPackage>();
  const filers = new Map<string, string>();
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
    for (const role of builder.roles) {
      if (role.name !== "coordinator" && !role.ended)
        throw new Error(`${name}'s role ${role.name} needs ended wording`);
      declare(roles, "the role", name, role.name, role);
    }
    if (builder.settings)
      for (const [setting, declared] of Object.entries(builder.settings))
        declare(settings, "the model setting", name, setting, declared);
    for (const [pkg, declared] of Object.entries(builder.packages)) {
      const { entry, role, files } = declared;
      if (!builder.roles.some((own) => own.name === role))
        throw new Error(
          `${name}'s package ${pkg} plays the role ${role}, which ${name} does not declare`,
        );
      const path = resolve(root, entry);
      if (!(await Bun.file(path).exists()))
        throw new Error(`${name}'s package ${pkg} has no entry at ${entry}`);
      const realEntry = await realpath(path);
      if (relative(await realpath(root), realEntry).split(sep)[0] === "..")
        throw new Error(
          `${name}'s package ${pkg} has its entry outside the plugin, at ${entry}`,
        );
      declare(packages, "the workflow package", name, pkg, {
        role,
        entry: realEntry,
      });
      declarations.set(pkg, declared);
      if (files) declare(filers, "the filer of", name, files, pkg);
    }
  }
  for (const role of roles.values())
    if (!settings.has(role.model))
      throw new Error(
        `The role ${role.name} runs on ${role.model}, a model setting no plugin declares`,
      );
  const substitutions = new Map<string, { package: string; when: string }>();
  const aliases = new Map<string, string>();
  for (const [name, declared] of declarations) {
    const alias = declared.legacyAlias;
    if (alias) {
      if (
        packages.has(alias) ||
        [...aliases.values()].includes(alias) ||
        declared.role !== alias ||
        declared.replaces
      )
        throw new Error(
          `The package ${name} has an ambiguous or different-role alias ${alias}`,
        );
      aliases.set(name, alias);
    }
    const replacement = declared.replaces;
    if (!replacement) continue;
    if (substitutions.has(replacement.package))
      throw new Error(
        `Another package already replaces ${replacement.package}`,
      );
    const target = declarations.get(replacement.package);
    if (
      !target ||
      target.role !== declared.role ||
      target.replaces ||
      replacement.package === name
    )
      throw new Error(
        `The package ${name} must replace an unconditional package of the same role`,
      );
    if (!booleanPreferences.has(replacement.when))
      throw new Error(
        `The package ${name} names ${replacement.when}, not a yes/no preference`,
      );
    substitutions.set(replacement.package, {
      package: name,
      when: replacement.when,
    });
  }
  return {
    packages,
    roles: [...roles.values()],
    role: (name) => roles.get(name),
    settings,
    filers,
    substitutions,
    aliases,
  };
}
