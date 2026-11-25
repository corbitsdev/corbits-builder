/**
 * A plugin's screens shown of their own accord in the main pane, each a tab of the project view
 * opened from its entries, and the plugin space a question's screen opens in.
 */
import {
  Component,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ShownScreen } from "@corbits-builder/schemas/project";
import { screenWords } from "./roles.ts";
import type { ScreenLookup } from "./screens.ts";
import {
  ScreenQuestion,
  type HostSupplies,
  type ListedHostProps,
  type ScreenQuestionProps,
} from "./screen-question.tsx";

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
  entries: ShownScreen["entries"];
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
    const installed = room.screenOf(screen);
    if (installed === undefined) continue;
    const { changesIn } = screen;
    if (changesIn !== undefined)
      rereadIn = Math.min(rereadIn ?? Infinity, changesIn);
    if (installed.places["main-pane"] === undefined) continue;
    const { listed: Listed } = installed;
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
      entries: screen.entries,
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
