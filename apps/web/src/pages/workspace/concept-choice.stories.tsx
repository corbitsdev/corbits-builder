import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import designer from "@plugins/designer/package.json";
import definition from "@plugins/designer/src/choose/definition.ts";
import View from "@plugins/designer/src/choose/view.tsx";
import type { ComponentProps } from "react";
import { wording } from "../../config.ts";
import { InBox, useBoxPorts } from "./box-ports.tsx";
import { composer } from "./prompt-box.fixtures.ts";
import { RoomDockView } from "./prompt-box.view.tsx";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

// Crisp is picked in the draft, so the forward button names it.
const SEND = "Use Crisp";

const screen = storyScreen(
  "@corbits-builder/designer choose",
  designer.builder.actions["choose"],
  {
    screen: definition,
    view: View,
    data: undefined,
  },
);

// In the plugin space beside the room's main area.
const meta = {
  title: "Screens/Plugins/ConceptChoice",
  component: ScreenStory,
  parameters: { layout: "fullscreen" },
  args: {
    screen,
    state: "open",
    input: {},
    project: {},
    draft: {
      concept: "Crisp",
      version: 1,
      comments: [{ concept: "Warm", text: "Love the serif." }],
    },
    output: {
      concept: "Crisp",
      option: "design-option-2",
      version: 1,
      comments: [],
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: 16,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked yet: the forward button waits, saying what it does. */
export const Open: Story = {};
/** A concept picked: it is marked in ink and the forward button, green, names it. */
export const Chosen: Story = { args: { state: "chosen" } };
/** While the answer is on its way the whole screen is inert. */
export const Sending: Story = { args: { state: "sending" } };
/** The hub refused the answer: one sentence above the actions, the choice kept. */
export const Refused: Story = {
  args: { state: "refused" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: SEND }));
    await expect(
      await canvas.findByText(wording.questions.answerFault.refused),
    ).toBeVisible();
  },
};
export const Answered: Story = {
  args: { state: "answered" },
};
export const Replied: Story = {
  args: { state: "replied" },
};
export const Closed: Story = {
  args: { state: "closed" },
};
/** This interface has no view for the screen. */
export const NotInstalled: Story = {
  args: { state: "missing" },
};

// The picker in the plugin space with the prompt box beside it, sharing the box as the room does.
function OverTheBox(props: ComponentProps<typeof ScreenStory>) {
  const ports = useBoxPorts();
  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <InBox ports={ports} as="space">
          <ScreenStory {...props} />
        </InBox>
      </div>
      <div style={{ width: "min(560px, 100%)", margin: "0 auto" }}>
        <RoomDockView
          dock={{
            ...composer,
            placeholder:
              definition.describe?.says?.reply ?? composer.placeholder,
          }}
          ports={ports}
        />
      </div>
    </>
  );
}

/**
 * Over the prompt box with nothing picked: the box asks for a different design if none fits, and
 * its Send waits; there is no second forward button on the page.
 */
export const OverTheBoxNothingPicked: Story = { render: OverTheBox };

/**
 * A concept picked: "Use Crisp", green, stands where Send does, and the box asks for details to go
 * with it.
 */
export const OverTheBoxPicked: Story = {
  args: { state: "chosen" },
  render: OverTheBox,
};
