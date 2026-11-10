import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  TweakPanelView,
  type TweakPanelViewProps,
} from "./mockup-tweaks.view.tsx";

// Holds the tweaks, which the mockup's frame keeps for the panel.
function Panel(args: TweakPanelViewProps) {
  const [tweaks, setTweaks] = useState(args.tweaks);
  return <TweakPanelView {...args} tweaks={tweaks} onChange={setTweaks} />;
}

const args: TweakPanelViewProps = {
  look: {
    primary: "#e98428",
    background: "#faf7f2",
    radius: 0.5,
    font: "system-ui, sans-serif",
  },
  tweaks: {},
  onChange: fn(),
  onClose: fn(),
  onSave: fn(),
  saving: false,
};

const meta = {
  title: "Screens/Workspace/TweakPanel",
  component: TweakPanelView,
  args,
  render: (args) => <Panel {...args} />,
} satisfies Meta<typeof TweakPanelView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing changed yet, so there is nothing to reset or save. */
export const Untouched: Story = {};

export const Changed: Story = {
  args: { tweaks: { primary: "#2563eb", radius: 1 } },
};

export const Saving: Story = {
  args: { tweaks: { primary: "#2563eb", radius: 1 }, saving: true },
};

/** A design theme's example has no design to save into, so the panel only tries looks on. */
export const NothingToSaveInto: Story = {
  args: { tweaks: { background: "#f5f7fa" }, onSave: null },
};
