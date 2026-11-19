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
  ReadyPlanBuilder,
  ScreenActionBuilder,
  SpecialistBuilder,
  type ReadyPlanOffer,
} from "@corbits-builder/plugin";
import { actionRole, byAction, pluginFolder } from "./roles.ts";
import {
  screenHost,
  type ViewResources,
  type ScreenHostProps,
} from "./screen-question.tsx";

/** The plugins' files the interface bundles, by path from this folder. */
export type ScreenFiles = {
  manifests: Record<
    string,
    { name: string; description?: string; builder?: unknown }
  >;
  definitions: Record<string, unknown>;
  data: Record<string, unknown>;
  views: Record<
    string,
    ComponentType<ScreenViewProps<unknown, unknown, unknown, ViewResources>>
  >;
};

type Installed = {
  host: ComponentType<ScreenHostProps>;
  // Where its manifest places it, or the conversation when the manifest names no place.
  place: ScreenActionBuilder["place"];
};

let installed: ReadonlyMap<string, Installed> = new Map();

type ReadyPlan = Omit<ReadyPlanOffer, "takeDown"> & {
  takeDown: { plugin: string; action: string } | undefined;
  groups: readonly string[];
  ends: string | undefined;
};

let readyPlans: readonly ReadyPlan[] = [];

// The specialists' handles, each with the groups its manifest lists.
let specialistGroups: ReadonlyMap<string, readonly string[]> = new Map();

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
  const groups = new Map<string, readonly string[]>();
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
          groups: listed,
          default: isDefault,
        } = SpecialistBuilder.assert(builder);
        const shared = { name: packageName, isDefault: isDefault === true };
        const same = sharing.get(handle);
        if (same === undefined) sharing.set(handle, [shared]);
        else same.push(shared);
        groups.set(handle, [...(groups.get(handle) ?? []), ...listed]);
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
          return [[name, { host, place: declared.place }] as const];
        });
      },
    ),
  );
  packages = sharing;
  specialistGroups = groups;
  readyPlans = offeredPlans(manifests);
}

// One plan per handle. When plans share a handle, the one marked as the default wins, as it does
// for a project that selects none.
function offeredPlans(manifests: ScreenFiles["manifests"]): ReadyPlan[] {
  const plans = Object.values(manifests).flatMap(({ description, builder }) => {
    if (
      typeof builder !== "object" ||
      builder === null ||
      !("runs" in builder) ||
      builder.runs !== "plan"
    )
      return [];
    const plan = ReadyPlanBuilder.assert(builder);
    return [
      {
        handle: plan.handle,
        about: description ?? plan.when,
        firstPublish: plan.firstPublish,
        when: plan.when,
        plugins: [...new Set(plan.steps.map((step) => step.plugin))],
        takeDown: plan.takeDown,
        groups: plan.groups,
        ends: plan.ends,
        isDefault: plan.default === true,
      },
    ];
  });
  return plans.flatMap(({ isDefault, ...plan }) =>
    isDefault ||
    !plans.some((other) => other.handle === plan.handle && other.isDefault)
      ? [plan]
      : [],
  );
}

/** The installed ready-made plans that list a group, worded by their manifests and actions. */
export const readyPlansIn = (group: string): readonly ReadyPlanOffer[] =>
  readyPlans
    .filter((plan) => plan.groups.includes(group))
    .map(({ handle, about, firstPublish, when, plugins, takeDown }) => ({
      handle,
      about,
      firstPublish,
      when,
      plugins,
      takeDown:
        takeDown === undefined
          ? undefined
          : {
              ...takeDown,
              removes: actionRole(`${takeDown.plugin} ${takeDown.action}`)?.says
                ?.removes,
            },
    }));

/** The facts that end the installed ready-made plans listing a group. */
export const planEndsIn = (group: string): readonly string[] =>
  readyPlans.flatMap((plan) =>
    plan.groups.includes(group) && plan.ends !== undefined ? [plan.ends] : [],
  );

/** The handles of the installed specialists that list a group. */
export const specialistsIn = (group: string): readonly string[] =>
  [...specialistGroups].flatMap(([handle, listed]) =>
    listed.includes(group) ? [handle] : [],
  );

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
