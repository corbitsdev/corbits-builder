/**
 * Where a plugin's screens show. A screen meant for a tab of its own stays a tab in the project
 * view, saying where its work stands; every other screen, the coordinator's question asked with a
 * plugin's screen or one a plugin shows of its own accord for the chat or the main page, opens in
 * the plugin space.
 */
import { Component, type ComponentType, type ReactNode } from "react";
import type { ScreenStatus } from "@corbits-builder/plugin";
import {
  ScreenQuestion,
  type ListedHostProps,
  type ScreenQuestionProps,
} from "./screen-question.tsx";

export type PluginTab = {
  value: string;
  label: string;
  pane: Extract<SpaceScreenProps, { kind: "plugin" }>;
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
