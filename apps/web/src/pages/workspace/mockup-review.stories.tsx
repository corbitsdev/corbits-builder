import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import designer from "@plugins/designer/package.json";
import definition from "@plugins/designer/src/review/definition.ts";
import View from "@plugins/designer/src/review/view.tsx";
import { wording } from "../../config.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const comment = {
  text: "Make the order list easier to scan.",
  at: {
    page: "index.html",
    screen: "orders",
    state: "populated",
    tag: "ul",
    box: [24, 96, 480, 64],
  },
};
const SEND = wording.questions.cancel;

const screen = storyScreen(
  "@corbits-builder/designer review",
  designer.builder.actions["review"],
  {
    screen: definition,
    view: View,
    data: undefined,
  },
);

// Placed on the page: the room covers the conversation with it, and the conversation keeps a card
// that opens it again.
const meta = {
  title: "Screens/Plugins/MockupReview",
  component: ScreenStory,
  parameters: { layout: "fullscreen" },
  args: {
    screen,
    state: "open",
    placed: "page",
    input: { note: "The second round, with the order list tightened." },
    project: {},
    draft: { comments: [comment] },
    output: { decision: "changes", version: 2, comments: [comment] },
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

export const Open: Story = {};
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
  args: { state: "answered", placed: "conversation" },
};
export const Replied: Story = {
  args: { state: "replied", placed: "conversation" },
};
export const Closed: Story = {
  args: { state: "closed", placed: "conversation" },
};
/** This interface has no view for the screen. */
export const NotInstalled: Story = {
  args: { state: "missing", placed: "conversation" },
};
