import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import designer from "@plugins/designer/package.json";
import definition from "@plugins/designer/src/looks/definition.ts";
import View from "@plugins/designer/src/looks/view.tsx";
import { wording } from "../../../config.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const SEND = "Compare two looks";

const screen = storyScreen(
  "@corbits-builder/designer looks",
  designer.builder.actions["looks"],
  {
    screen: definition,
    view: View,
    data: undefined,
  },
);

const meta = {
  title: "Screens/Plugins/LooksCount",
  component: ScreenStory,
  args: {
    screen,
    state: "open",
    input: { current: "three" },
    project: {},
    draft: { looks: "two" },
    output: { looks: "two" },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Chosen: Story = { args: { state: "chosen" } };
/** While the answer is on its way the whole screen is inert and its action says so. */
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
export const Answered: Story = { args: { state: "answered" } };
export const Replied: Story = { args: { state: "replied" } };
export const Closed: Story = { args: { state: "closed" } };
/** This interface has no view for the screen. */
export const NotInstalled: Story = { args: { state: "missing" } };
