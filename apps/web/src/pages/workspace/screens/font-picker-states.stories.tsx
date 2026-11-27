import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import designer from "@plugins/designer/package.json";
import definition from "@plugins/designer/src/pick-fonts/definition.ts";
import View from "@plugins/designer/src/pick-fonts/view.tsx";
import fonts from "@plugins/designer/src/pick-fonts/data.json";
import { Fonts } from "@plugins/designer/src/pick-fonts/schema.ts";
import { wording } from "../../../config.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const offered = Fonts.assert(fonts);
const font = (name: string) => {
  const found = offered.find((each) => each.name === name);
  if (found === undefined) throw new Error(`${name} is not offered.`);
  return found;
};
const SEND = "Change my fonts";

const screen = storyScreen(
  "@corbits-builder/designer pick-fonts",
  designer.builder.actions["pick-fonts"],
  {
    screen: definition,
    view: View,
    data: offered,
  },
);

const meta = {
  title: "Screens/Plugins/FontPickerStates",
  component: ScreenStory,
  args: {
    screen,
    state: "open",
    input: { proposed: { primary: "Fraunces" } },
    project: {
      "look.font-primary": "Inter",
      "look.font-secondary": "JetBrains Mono",
    },
    draft: { primary: font("Fraunces") },
    output: { primary: font("Fraunces"), secondary: font("JetBrains Mono") },
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
