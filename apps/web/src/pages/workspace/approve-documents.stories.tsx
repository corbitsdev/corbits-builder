import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import writer from "@plugins/writer/package.json";
import definition from "@plugins/writer/src/approve/definition.ts";
import View from "@plugins/writer/src/approve/view.tsx";
import { wording } from "../../config.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

// Approving is the screen's only choice, so a choice made reads as the open card.
const SEND = "Approve";

const screen = storyScreen(
  "@corbits-builder/writer approve",
  writer.builder.actions["approve"],
  {
    screen: definition,
    view: View,
    data: undefined,
  },
);

const meta = {
  title: "Screens/Plugins/ApproveDocuments",
  component: ScreenStory,
  args: {
    screen,
    state: "open",
    input: { kinds: ["build_plan"] },
    project: {},
    output: {
      approved: [
        { kind: "build_plan", artifactId: "artifact-plan", version: 2 },
      ],
    },
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
