import type { ReactElement } from "react";
import type {
  ScreenRender,
  ShownScreen,
} from "@corbits-builder/schemas/project";
import { screenWords } from "./roles.ts";
import type { ScreenLookup } from "./screens.ts";
import type { HostSupplies, ListedHostProps } from "./screen-question.tsx";

/** The room's slot each place draws in; the only mapping from a place to the room. */
export const SLOT = {
  "main-page": "page",
  "inline-chat": "chat",
  "plugin-bar": "tab",
} as const satisfies Record<ScreenRender, "page" | "chat" | "tab">;

/** What a listed screen needs from the room: where it is found, what it is given, and how it acts. */
export type PluginScreensRoom = {
  screens: readonly ShownScreen[];
  screenOf: ScreenLookup;
  supplies: HostSupplies;
  act: ListedHostProps["act"];
};

/** A plugin-bar screen as a tab of the project view. */
export type PluginTab = { value: string; label: string; pane: ReactElement };

/** The screens the hub lists now, each drawn with its state in the slot its place maps to. */
export function pluginSlots(room: PluginScreensRoom) {
  const slots: {
    page: ReactElement[];
    chat: ReactElement[];
    tabs: PluginTab[];
  } = { page: [], chat: [], tabs: [] };
  for (const screen of room.screens) {
    const Listed = room.screenOf(screen)?.listed;
    if (Listed === undefined) continue;
    const element = (
      <Listed
        key={`${screen.plugin} ${screen.action}`}
        state={screen.state}
        act={room.act}
        host={room.supplies}
      />
    );
    const slot = SLOT[screen.render];
    if (slot === "tab")
      slots.tabs.push({
        value: `plugin-${screen.plugin}-${screen.action}`,
        label:
          screenWords(screen.plugin, screen.action)?.label({}) ?? screen.action,
        pane: element,
      });
    else slots[slot].push(element);
  }
  return slots;
}

export type PluginSlots = ReturnType<typeof pluginSlots>;
