import { Component, type ReactElement, type ReactNode } from "react";
import type { ScreenStatus } from "@corbits-builder/plugin";
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

export type PluginTab = {
  value: string;
  label: string;
  pane: ReactElement;
  status: ScreenStatus | undefined;
};

/** One plugin's screen that fails to draw shows nothing, and the room around it carries on. */
class Contained extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error(`${this.props.name} failed to draw.`, error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function pluginSlots(room: PluginScreensRoom) {
  const slots: {
    page: ReactElement[];
    chat: ReactElement[];
    tabs: PluginTab[];
    // In how many milliseconds the clock alone changes a drawn screen, so the room reads it again.
    rereadIn: number | undefined;
  } = { page: [], chat: [], tabs: [], rereadIn: undefined };
  for (const screen of room.screens) {
    const Listed = room.screenOf(screen)?.listed;
    if (Listed === undefined) continue;
    const { changesIn } = screen;
    if (changesIn !== undefined)
      slots.rereadIn = Math.min(slots.rereadIn ?? Infinity, changesIn);
    const key = `${screen.plugin} ${screen.action}`;
    const element = (
      <Contained key={key} name={key}>
        <Listed state={screen.state} act={room.act} host={room.supplies} />
      </Contained>
    );
    const slot = SLOT[screen.render];
    if (slot === "tab")
      slots.tabs.push({
        value: `plugin-${screen.plugin}-${screen.action}`,
        label:
          screenWords(screen.plugin, screen.action)?.label({}) ?? screen.action,
        pane: element,
        status: screen.status,
      });
    else slots[slot].push(element);
  }
  return slots;
}

export type PluginSlots = ReturnType<typeof pluginSlots>;
