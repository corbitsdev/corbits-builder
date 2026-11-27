import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ConceptMockupView,
  type ConceptMockupViewProps,
} from "./design-concepts.view.tsx";
import { TweakPanelView } from "./mockup-tweaks.view.tsx";
import { sampleDesign } from "./sample-design.ts";

const onSave = fn();
const DIRECTION = "Warm paper tones with one orange accent.";

// Holds the device the pane keeps for the concept.
function Concept(args: ConceptMockupViewProps) {
  const [device, setDevice] = useState(args.device);
  return (
    <div style={{ height: 640, display: "flex", flexDirection: "column" }}>
      <ConceptMockupView {...args} device={device} onDevice={setDevice} />
    </div>
  );
}

const args: ConceptMockupViewProps = {
  direction: DIRECTION,
  files: sampleDesign,
  device: "desktop",
  onDevice: fn(),
  tweakPanel: (panel) => (
    <TweakPanelView {...panel} onSave={onSave} saving={false} />
  ),
};

const meta = {
  title: "Screens/Workspace/DesignConcept",
  component: ConceptMockupView,
  parameters: { layout: "fullscreen" },
  args,
  render: (args) => <Concept {...args} />,
} satisfies Meta<typeof ConceptMockupView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The concept's filed design, its direction behind the bar's info tip. */
export const Filed: Story = {};

export const FiledUnreadable: Story = {
  args: { files: null },
};
