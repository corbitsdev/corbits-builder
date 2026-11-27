import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  DesignPreviewView,
  type DesignPreviewViewProps,
} from "./design-preview.view.tsx";
import { TweakPanelView, type TweakPanelProps } from "./mockup-tweaks.view.tsx";
import { sampleDesign, sampleDraft } from "./sample-design.ts";

const onSave = fn();
const tweakPanel = (panel: TweakPanelProps) => (
  <TweakPanelView {...panel} onSave={onSave} saving={false} />
);

// Holds the device the pane keeps for the preview.
function Preview(args: DesignPreviewViewProps) {
  const [device, setDevice] = useState(args.device);
  return (
    <div style={{ height: 640 }}>
      <DesignPreviewView {...args} device={device} onDevice={setDevice} />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/DesignPreview",
  component: DesignPreviewView,
  parameters: { layout: "fullscreen" },
  args: {
    files: sampleDesign,
    part: "mockup",
    device: "desktop",
    onDevice: fn(),
    tweakPanel,
  },
  render: (args) => <Preview {...args} />,
} satisfies Meta<typeof DesignPreviewView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The clickable mockup; the bar's Screen menu and palette act on it. */
export const Mockup: Story = {};

export const MockupOnPhone: Story = { args: { device: "phone" } };

export const NoPlanWritten: Story = {
  args: { part: "plan", files: sampleDraft },
};

export const CannotBeShown: Story = { args: { files: null } };
