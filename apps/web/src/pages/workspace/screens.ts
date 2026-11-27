import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
/**
 * The plugin screens this interface can draw, by package and action: every action of every
 * specialist in the plugins folder that has a view. Plugins may share a handle, so a question's handle is resolved
 * to the package the project uses. The app entry hands over the plugins' files once, from
 * screen-files.ts, so nothing else that imports this module needs a bundler to load it.
 */
import type { ComponentType } from "react";
import {
  isScreen,
  ScreenActionBuilder,
  SpecialistBuilder,
} from "@corbits-builder/plugin";
import type {
  ScreenRender,
  ShownScreen,
} from "@corbits-builder/schemas/project";
import { byAction, pluginFolder, screenWords } from "./roles.ts";
import type { PluginTab } from "./plugin-screens.tsx";
import {
  listedHost,
  screenHost,
  type HostSupplies,
  type ListedHostProps,
  type ViewResources,
  type ScreenHostProps,
} from "./screen-question.tsx";

export const SLOT = {
  "main-page": "page",
  "inline-chat": "chat",
  "plugin-bar": "tab",
} as const satisfies Record<ScreenRender, "page" | "chat" | "tab">;

/** The plugins' files the interface bundles, by path from this folder. */
export type ScreenFiles = {
  manifests: Record<string, { name: string; builder?: unknown }>;
  definitions: Record<string, unknown>;
  data: Record<string, unknown>;
  views: Record<
    string,
    ComponentType<ScreenViewProps<unknown, unknown, unknown, ViewResources>>
  >;
};

type Installed = {
  host: ComponentType<ScreenHostProps>;
  listed: ComponentType<ListedHostProps>;
  /** The plugin draws it for the page, so it opens beside the room; any other answers in the box. */
  page: boolean;
};

let installed: ReadonlyMap<string, Installed> = new Map();

// The specialist packages sharing each handle, and which of them says it is the default.
let packages: ReadonlyMap<
  string,
  readonly { name: string; isDefault: boolean }[]
> = new Map();

const key = (plugin: string, action: string) => `${plugin} ${action}`;

// The project value that selects which plugin of a handle the project uses, as the hub names it.
const selectionName = (handle: string) => `plugins.${handle}`;

/** The project values that select between plugins sharing a handle, to read before screens resolve. */
export const selectionNames = () =>
  [...packages]
    .filter(([, sharing]) => sharing.length > 1)
    .map(([handle]) => selectionName(handle));

/** Makes every screen action in the given files drawable. */
export function installScreens({
  manifests,
  definitions,
  data,
  views,
}: ScreenFiles) {
  const definitionOf = byAction(definitions);
  const dataOf = byAction(data);
  const viewOf = byAction(views);
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
        const folder = pluginFolder(path);
        const {
          handle,
          actions,
          default: isDefault,
        } = SpecialistBuilder.assert(builder);
        const shared = { name: packageName, isDefault: isDefault === true };
        const same = sharing.get(handle);
        if (same === undefined) sharing.set(handle, [shared]);
        else same.push(shared);
        return Object.entries(actions).flatMap(([action, entry]) => {
          const files = `${folder} ${action}`;
          const view = viewOf.get(files);
          if (view === undefined) return [];
          const name = key(packageName, action);
          const declared = ScreenActionBuilder.assert(entry);
          const screen = definitionOf.get(files);
          if (!isScreen(screen))
            throw new Error(
              `${name}'s src/${action}/definition.ts exports no screen.`,
            );
          const shipped = dataOf.get(files);
          let data: unknown;
          if (shipped !== undefined) {
            if (!screen.data)
              throw new Error(
                `${name} ships data its screen has no schema for.`,
              );
            data = screen.data.assert(shipped);
          }
          const host = screenHost(name, declared, { screen, view, data });
          const listed = listedHost(name, handle, view);
          const page =
            screen.render !== undefined && SLOT[screen.render] === "page";
          return [[name, { host, listed, page }] as const];
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
    const sharing = packages.get(plugin);
    if (sharing === undefined) return undefined;
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
  const sharing = packages.get(plugin);
  if (sharing === undefined) return false;
  return sharing.some(({ name }) => installed.has(key(name, action)));
}

/** A screen meant for a tab of its own, which the project view shows rather than the space. */
export const inTab = (screen: ShownScreen) => SLOT[screen.render] === "tab";

type PluginScreensRoom = {
  screens: readonly ShownScreen[];
  screenOf: ScreenLookup;
  supplies: HostSupplies;
  act: ListedHostProps["act"];
};

/** The project view's plugin tabs, and when the clock alone next changes any shown screen. */
export function pluginTabs(room: PluginScreensRoom) {
  const tabs: PluginTab[] = [];
  // In how many milliseconds the clock alone changes a drawn screen, so the room reads it again.
  let rereadIn: number | undefined;
  for (const screen of room.screens) {
    const Listed = room.screenOf(screen)?.listed;
    if (Listed === undefined) continue;
    const { changesIn } = screen;
    if (changesIn !== undefined)
      rereadIn = Math.min(rereadIn ?? Infinity, changesIn);
    if (!inTab(screen)) continue;
    tabs.push({
      value: `plugin-${screen.plugin}-${screen.action}`,
      label:
        screenWords(screen.plugin, screen.action)?.label({}) ?? screen.action,
      pane: {
        kind: "plugin",
        name: `${screen.plugin} ${screen.action}`,
        Listed,
        listed: { state: screen.state, act: room.act, host: room.supplies },
      },
      status: screen.status,
    });
  }
  return { tabs, rereadIn };
}
