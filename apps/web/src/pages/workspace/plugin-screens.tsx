/**
 * Where a plugin's screens show. A screen meant for a tab of its own stays a tab in the project
 * view, saying where its work stands; every other screen, the coordinator's question asked with a
 * plugin's screen or one a plugin shows of its own accord for the chat or the main page, opens in
 * the plugin space.
 */
import {
  Component,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ScreenStatus } from "@corbits-builder/plugin";
import type { ShownScreen } from "@corbits-builder/schemas/project";
import { screenWords } from "./roles.ts";
import { SLOT, type ScreenLookup } from "./screens.ts";
import {
  ScreenQuestion,
  type HostSupplies,
  type ListedHostProps,
  type ScreenQuestionProps,
} from "./screen-question.tsx";

/** A screen meant for a tab of its own, which the project view shows rather than the space. */
export const inTab = (screen: ShownScreen) => SLOT[screen.render] === "tab";

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
    const key = `${screen.plugin} ${screen.action}`;
    tabs.push({
      value: `plugin-${screen.plugin}-${screen.action}`,
      label:
        screenWords(screen.plugin, screen.action)?.label({}) ?? screen.action,
      pane: (
        <Contained key={key} name={key}>
          <Listed state={screen.state} act={room.act} host={room.supplies} />
        </Contained>
      ),
      status: screen.status,
    });
  }
  return { tabs, rereadIn };
}

export type SpaceScreenProps =
  | { kind: "question"; question: ScreenQuestionProps }
  | {
      kind: "plugin";
      name: string;
      Listed: ComponentType<ListedHostProps>;
      listed: ListedHostProps;
    };

export function SpaceScreen(props: SpaceScreenProps) {
  if (props.kind === "question") return <ScreenQuestion {...props.question} />;
  const { name, Listed, listed } = props;
  return (
    <Contained key={name} name={name}>
      <Listed {...listed} />
    </Contained>
  );
}
