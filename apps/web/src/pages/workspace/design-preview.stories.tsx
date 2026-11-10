import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  DesignPreviewView,
  draftBadge,
  MockupFrameView,
  type DesignPreviewViewProps,
} from "./design-preview.view.tsx";
import type { PreviewDevice } from "./device-preview.tsx";
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

/** The design's written plan, read as a document. */
export const Plan: Story = { args: { part: "plan" } };

export const NoPlanWritten: Story = {
  args: { part: "plan", files: sampleDraft },
};

export const CannotBeShown: Story = { args: { files: null } };

function Draft({ working }: { working: boolean }) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  return (
    <div style={{ height: 640 }}>
      <MockupFrameView
        files={sampleDraft}
        device={device}
        onDevice={setDevice}
        leading={[draftBadge(working)]}
        tweakPanel={tweakPanel}
        fill
      />
    </div>
  );
}

/** The designer's unfiled draft, while the designer is mid-turn. */
export const DraftInProgress: Story = { render: () => <Draft working /> };

/** The draft while its designer is parked between turns. */
export const DraftIdle: Story = { render: () => <Draft working={false} /> };
