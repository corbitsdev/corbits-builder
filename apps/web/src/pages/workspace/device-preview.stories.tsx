import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DevicePreview, type PreviewDevice } from "./device-preview.tsx";
import { GuiFrame } from "./gui-frame.tsx";

const PAGE = `<!doctype html>
<html><body style="font-family: system-ui; margin: 0; padding: 24px">
<h1>Orders</h1>
<p>Saturday, 66 orders.</p>
<ul><li>Lemon cake, 2pm</li><li>Sourdough x4, 9am</li></ul>
</body></html>`;

const meta = {
  title: "Components/Workspace/DevicePreview",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function Preview({ html }: { html: string }) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  return (
    <div style={{ height: 640 }}>
      <DevicePreview html={html} device={device} onDevice={setDevice} />
    </div>
  );
}

/** A mockup in a desktop or phone frame; the frame is a size cue, not a running app. */
export const Mockup: StoryObj = {
  render: () => <Preview html={PAGE} />,
};

/** Nothing to show yet. */
export const Empty: StoryObj = {
  render: () => <Preview html="" />,
};

/** The sandboxed frame on its own. */
export const Frame: StoryObj = {
  render: () => (
    <div style={{ height: 400 }}>
      <GuiFrame html={PAGE} />
    </div>
  ),
};
