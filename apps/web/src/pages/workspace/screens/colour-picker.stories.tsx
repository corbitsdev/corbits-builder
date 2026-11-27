import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import designer from "@plugins/designer/package.json";
import definition from "@plugins/designer/src/pick-colours/definition.ts";
import View, {
  text as colourText,
} from "@plugins/designer/src/pick-colours/view.tsx";
import { wording } from "../../../config.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const SEND = "Change my colours";

const screen = storyScreen(
  "@corbits-builder/designer pick-colours",
  designer.builder.actions["pick-colours"],
  {
    screen: definition,
    view: View,
    data: undefined,
  },
);

const meta = {
  title: "Screens/Plugins/ColourPicker",
  component: ScreenStory,
  args: {
    screen,
    state: "open",
    input: { proposed: { primary: "#1d4ed8" } },
    project: {
      "look.color-primary": "#c2410c",
      "look.color-background": "#ffffff",
    },
    draft: { primary: "#1d4ed8" },
    output: { primary: "#1d4ed8", background: "#ffffff" },
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

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    const primary = await canvas.findByRole("textbox", {
      name: colourText.sides.primary,
    });
    await userEvent.clear(primary);
    await userEvent.type(primary, "#12");
    await userEvent.tab();
    await expect(primary).toHaveValue("#12");
    await expect(canvas.getByRole("button", { name: SEND })).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", {
        name: wording.questions.cancel,
      }),
    );
    await expect(
      await canvas.findByRole("region", {
        name: wording.questions.answeredInChat,
      }),
    ).toHaveFocus();
  },
};
export const SubmitFromSpace: Story = {
  args: { state: "chosen" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: SEND }));
    await expect(
      await canvas.findByRole("region", {
        name: wording.questions.screenAnswered,
      }),
    ).toHaveFocus();
  },
};
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
