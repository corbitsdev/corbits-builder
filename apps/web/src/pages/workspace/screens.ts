/**
 * The plugin screens this interface can draw, by plugin handle: every screen plugin in the plugins
 * folder, compiled in when the interface is built, so a new plugin folder needs a rebuild.
 */
import type { ComponentType } from "react";
import {
  Builder,
  isScreen,
  type ScreenViewProps,
} from "@corbits-builder/plugin";
import {
  screenHost,
  type HostSupplies,
  type ScreenHostProps,
} from "./screen-question.tsx";

const manifests = import.meta.glob<{ builder?: unknown }>(
  "../../../../../plugins/*/package.json",
  { eager: true, import: "default" },
);
// Only these files of a plugin are bundled: the rest of its folder is the hub's, which may not
// run in a browser.
const modules = import.meta.glob(
  [
    "../../../../../plugins/*/src/screen.ts",
    "../../../../../plugins/*/data/*.json",
  ],
  { eager: true, import: "default" },
);
const views = import.meta.glob<
  ComponentType<ScreenViewProps<unknown, unknown, unknown, HostSupplies>>
>("../../../../../plugins/*/src/view.tsx", { eager: true, import: "default" });

// What a screen plugin's manifest names, from the files bundled above.
function named<File>(
  files: Record<string, File>,
  folder: string,
  handle: string,
  path: string,
) {
  const file = files[folder + path.replace(/^\.\//, "")];
  if (file === undefined)
    throw new Error(
      `${handle} names ${path}, which the interface does not bundle: a screen is src/screen.ts, its view src/view.tsx and its data under data/.`,
    );
  return file;
}

const builders = Object.entries(manifests).flatMap(([path, { builder }]) =>
  typeof builder === "object" &&
  builder !== null &&
  "runs" in builder &&
  builder.runs === "screen"
    ? [
        {
          folder: path.slice(0, -"package.json".length),
          builder: Builder.assert(builder),
        },
      ]
    : [],
);

/** The screens drawn over the whole room rather than in the conversation. */
export const pageScreens: ReadonlySet<string> = new Set(
  builders
    .filter(({ builder }) => builder.place === "page")
    .map(({ builder }) => builder.handle),
);

export const screens: Record<
  string,
  ComponentType<ScreenHostProps>
> = Object.fromEntries(
  builders.map(({ folder, builder }) => {
    const { handle } = builder;
    const screen = named(modules, folder, handle, builder.screen);
    if (!isScreen(screen))
      throw new Error(`${handle}'s ${builder.screen} exports no screen.`);
    let data: unknown;
    if (builder.data !== undefined) {
      if (!screen.data)
        throw new Error(`${handle} names data its screen has no schema for.`);
      data = screen.data.assert(named(modules, folder, handle, builder.data));
    }
    return [
      handle,
      screenHost(builder, {
        screen,
        view: named(views, folder, handle, builder.view),
        data,
        writes: screen.writes ?? {},
      }),
    ];
  }),
);
