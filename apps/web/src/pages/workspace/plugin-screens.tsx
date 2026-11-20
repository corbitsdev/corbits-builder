import type { ReactElement } from "react";
import type {
  ScreenRender,
  ShownScreen,
} from "@corbits-builder/schemas/project";
import { screenWords } from "./roles.ts";
import type { ScreenLookup } from "./screens.ts";
import type { HostSupplies, ListedHostProps } from "./screen-question.tsx";

export const SLOT = {
  "main-page": "page",
  "inline-chat": "chat",
  "plugin-bar": "tab",
} as const satisfies Record<ScreenRender, "page" | "chat" | "tab">;

type PluginScreensRoom = {
  screens: readonly ShownScreen[];
  screenOf: ScreenLookup;
  supplies: HostSupplies;
  act: ListedHostProps["act"];
};

export type PluginTab = { value: string; label: string; pane: ReactElement };

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
