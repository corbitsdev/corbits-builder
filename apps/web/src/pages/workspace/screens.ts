/**
 * The plugin screens this interface can draw, by plugin handle and action: every screen action of
 * every specialist in the plugins folder. The app entry hands over the plugins' files once, from
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
  manifests: Record<string, { builder?: unknown }>;
  modules: Record<string, unknown>;
  views: Record<
    string,
    ComponentType<ScreenViewProps<unknown, unknown, unknown, HostSupplies>>
  >;
};

type Installed = { host: ComponentType<ScreenHostProps>; page: boolean };

let installed: ReadonlyMap<string, Installed> = new Map();

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

/** Makes every screen action in the given files drawable. */
export function installScreens({ manifests, modules, views }: ScreenFiles) {
  installed = new Map(
    Object.entries(manifests).flatMap(([path, { builder }]) => {
      if (
        typeof builder !== "object" ||
        builder === null ||
        !("runs" in builder) ||
        builder.runs !== "specialist"
      )
        return [];
      const folder = path.slice(0, -"package.json".length);
      const { handle, actions } = SpecialistBuilder.assert(builder);
      return Object.entries(actions).flatMap(([action, declared]) => {
        if (declared.runs !== "screen") return [];
        const name = key(handle, action);
        const screen = named(modules, folder, name, declared.screen);
        if (!isScreen(screen))
          throw new Error(`${name}'s ${declared.screen} exports no screen.`);
        let data: unknown;
        if (declared.data !== undefined) {
          if (!screen.data)
            throw new Error(`${name} names data its screen has no schema for.`);
          data = screen.data.assert(
            named(modules, folder, name, declared.data),
          );
        }
        const host = screenHost(name, declared, {
          screen,
          view: named(views, folder, name, declared.view),
          data,
          writes: screen.writes ?? {},
        });
        return [[name, { host, page: declared.place === "page" }] as const];
      });
    }),
  );
}

/** The screen a question names, or undefined when this interface has none for it. */
export const screenOf = ({
  plugin,
  action,
}: {
  plugin: string;
  action?: string;
}) => (action === undefined ? undefined : installed.get(key(plugin, action)));
