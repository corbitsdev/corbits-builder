/**
 * The plugin screens this interface can draw, by package and action: every screen action of every
 * specialist in the plugins folder. Plugins may share a handle, so a question's handle is resolved
 * to the package the project uses. The app entry hands over the plugins' files once, from
 * screen-files.ts, so nothing else that imports this module needs a bundler to load it.
 */
import type { ComponentType } from "react";
import {
  isScreen,
  SpecialistBuilder,
  type ScreenViewProps,
} from "@corbits-builder/plugin";
import {
  screenHost,
  type HostSupplies,
  type ScreenHostProps,
} from "./screen-question.tsx";

/** The plugins' files the interface bundles, by path from this folder. */
export type ScreenFiles = {
  manifests: Record<string, { name: string; builder?: unknown }>;
  modules: Record<string, unknown>;
  views: Record<
    string,
    ComponentType<ScreenViewProps<unknown, unknown, unknown, HostSupplies>>
  >;
};

type Installed = { host: ComponentType<ScreenHostProps>; page: boolean };

let installed: ReadonlyMap<string, Installed> = new Map();

// The specialist packages sharing each handle, and which of them says it is the default.
let packages: ReadonlyMap<
  string,
  readonly { name: string; isDefault: boolean }[]
> = new Map();

// What a screen action's manifest names, from the files bundled.
function named<File>(
  files: Record<string, File>,
  folder: string,
  name: string,
  path: string,
) {
  const file = files[folder + path.replace(/^\.\//, "")];
  if (file === undefined)
    throw new Error(
      `${name} names ${path}, which the interface does not bundle: a screen is src/<action>/screen.ts, its view src/<action>/view.tsx and its data under data/.`,
    );
  return file;
}

const key = (plugin: string, action: string) => `${plugin} ${action}`;

// The project value that selects which plugin of a handle the project uses, as the hub names it.
const selectionName = (handle: string) => `plugins.${handle}`;

/** The project values that select between plugins sharing a handle, to read before screens resolve. */
export const selectionNames = () =>
  [...packages]
    .filter(([, sharing]) => sharing.length > 1)
    .map(([handle]) => selectionName(handle));

/** Makes every screen action in the given files drawable. */
export function installScreens({ manifests, modules, views }: ScreenFiles) {
  const sharing = new Map<string, { name: string; isDefault: boolean }[]>();
  installed = new Map(
    Object.entries(manifests).flatMap(
      ([path, { name: packageName, builder }]) => {
        if (
          typeof builder !== "object" ||
          builder === null ||
          !("runs" in builder) ||
          builder.runs !== "specialist"
        )
          return [];
        const folder = path.slice(0, -"package.json".length);
        const {
          handle,
          actions,
          default: isDefault,
        } = SpecialistBuilder.assert(builder);
        sharing.set(handle, [
          ...(sharing.get(handle) ?? []),
          { name: packageName, isDefault: isDefault === true },
        ]);
        return Object.entries(actions).flatMap(([action, declared]) => {
          if (declared.runs !== "screen") return [];
          const name = key(packageName, action);
          const screen = named(modules, folder, name, declared.screen);
          if (!isScreen(screen))
            throw new Error(`${name}'s ${declared.screen} exports no screen.`);
          let data: unknown;
          if (declared.data !== undefined) {
            if (!screen.data)
              throw new Error(
                `${name} names data its screen has no schema for.`,
              );
            data = screen.data.assert(
              named(modules, folder, name, declared.data),
            );
          }
          const host = screenHost(name, declared, {
            screen,
            view: named(views, folder, name, declared.view),
            data,
          });
          return [[name, { host, page: declared.place === "page" }] as const];
        });
      },
    ),
  );
  packages = sharing;
}

/**
 * Finds the screen a question names for a project with these values: the package its selection
 * names among those sharing the handle, else the default one, else the only one. Undefined when
 * this interface has no screen for it.
 */
export const screensFor =
  (values: Readonly<Record<string, unknown>>) =>
  ({ plugin, action }: { plugin: string; action?: string }) => {
    if (action === undefined) return undefined;
    const sharing = packages.get(plugin) ?? [];
    const chosen =
      sharing.find(({ name }) => name === values[selectionName(plugin)]) ??
      sharing.find(({ isDefault }) => isDefault) ??
      (sharing.length === 1 ? sharing[0] : undefined);
    return chosen && installed.get(key(chosen.name, action));
  };

export type ScreenLookup = ReturnType<typeof screensFor>;

/** Whether a call's plugin and action name a screen of any package with that handle. */
export function namesScreen(input: unknown) {
  if (typeof input !== "object" || input === null) return false;
  if (!("plugin" in input) || !("action" in input)) return false;
  const { plugin, action } = input;
  if (typeof plugin !== "string" || typeof action !== "string") return false;
  return (packages.get(plugin) ?? []).some(({ name }) =>
    installed.has(key(name, action)),
  );
}
