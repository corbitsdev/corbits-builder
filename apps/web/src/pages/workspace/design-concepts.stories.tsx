import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ConceptMockupView,
  type ConceptMockupViewProps,
} from "./design-concepts.view.tsx";
import { TweakPanelView } from "./mockup-tweaks.view.tsx";
import { sampleDesign, sampleDraft } from "./sample-design.ts";

const onSave = fn();
const DIRECTION = "Warm paper tones with one orange accent.";
// Recent enough that the sketch's clock reads a few minutes.
const STARTED = new Date(Date.now() - 4 * 60_000).toISOString();

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
  label: "Paper",
  direction: DIRECTION,
  mockup: { state: "filed", files: sampleDesign },
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
  args: { mockup: { state: "filed", files: null } },
};

/** The designer's unfiled draft, while the designer is mid-turn. */
export const DraftInProgress: Story = {
  args: { mockup: { state: "draft", files: sampleDraft, working: true } },
};

export const DraftIdle: Story = {
  args: { mockup: { state: "draft", files: sampleDraft, working: false } },
};

/** Nothing drafted yet: a sketch in the look of the theme the concept starts from. */
export const Sketching: Story = {
  args: {
    mockup: {
      state: "sketching",
      look: { primary: "#e98428", background: "#faf7f2", radius: 0.5 },
      designer: { startedAt: STARTED, working: true },
    },
  },
};

/** The designer is parked between turns, so the sketch is still and no clock runs. */
export const SketchingWhileDesignerWaits: Story = {
  args: {
    mockup: {
      state: "sketching",
      look: {},
      designer: { startedAt: STARTED, working: false },
    },
  },
};

/** No designer is known for the concept yet, and it names no direction. */
export const SketchingBeforeDesigner: Story = {
  args: {
    direction: undefined,
    mockup: { state: "sketching", look: {}, designer: undefined },
  },
};
