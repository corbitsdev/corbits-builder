/**
 * The screens the hub lists to show now, each drawn in the place it names with the state the hub
 * worked out for it; a click runs one of its plugin's actions through the hub. The only state kept
 * here is the plugin-bar tab the person picked.
 */
import type { ReactElement } from "react";
import type {
  ScreenRender,
  ShownScreen,
} from "@corbits-builder/schemas/project";
import { screenWords } from "./roles.ts";
import type { ScreenLookup } from "./screens.ts";
import type { HostSupplies, ListedHostProps } from "./screen-question.tsx";

/** What a listed screen needs from the room: where it is found, what it is given, and how it acts. */
export type PluginScreensRoom = {
  screens: readonly ShownScreen[];
  screenOf: ScreenLookup;
  supplies: HostSupplies;
  act: ListedHostProps["act"];
};

const screenOf = (room: PluginScreensRoom, screen: ShownScreen) =>
  room.screenOf(screen)?.listed;

const drawn = (room: PluginScreensRoom, render: ScreenRender) =>
  room.screens.flatMap((screen) => {
    const Listed = screenOf(room, screen);
    return screen.render === render && Listed !== undefined
      ? [
          {
            screen,
            element: (
              <Listed
                key={`${screen.plugin} ${screen.action}`}
                state={screen.state}
                act={room.act}
                host={room.supplies}
              />
            ),
          },
        ]
      : [];
  });

/** The listed screens of one place, such as the conversation's end or over the room. */
export function PluginScreens({
  room,
  render,
}: {
  room: PluginScreensRoom;
  render: Exclude<ScreenRender, "plugin-bar">;
}) {
  return <>{drawn(room, render).map(({ element }) => element)}</>;
}

/** The plugin-bar screens as the project view's tabs, and the tab the person picked. */
export type PluginTabs = {
  tabs: readonly { value: string; label: string; pane: ReactElement }[];
  shown: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
};

/** The tab the person picked among the plugin-bar screens, or null for none. */
export const pickTab = (
  _picked: string | null,
  event: { pick: string } | "close",
): string | null => (event === "close" ? null : event.pick);

export function pluginTabs(
  room: PluginScreensRoom,
  picked: string | null,
  pick: (event: { pick: string } | "close") => void,
): PluginTabs {
  const tabs = drawn(room, "plugin-bar").map(({ screen, element }) => ({
    value: `plugin-${screen.plugin}-${screen.action}`,
    label:
      screenWords(screen.plugin, screen.action)?.label({}) ?? screen.action,
    pane: element,
  }));
  return {
    tabs,
    shown: tabs.some((tab) => tab.value === picked) ? picked : null,
    onPick: (value) => pick({ pick: value }),
    onClose: () => pick("close"),
  };
}
