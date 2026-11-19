import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import { StatusPill } from "./status-pill.tsx";

const pill = wording.promptBox.pill;

// The states that change only the pill. Working, and comments waiting to be made, change the box
// too, so the prompt box's stories draw them.
const meta = {
  title: "Screens/Workspace/Status pill",
  component: StatusPill,
  args: {
    state: "ready",
    label: "Problem brief is ready",
    action: pill.open,
    onPress: fn(),
  },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const AppRunning: Story = {
  args: { state: "running", label: "The app is running", action: pill.open },
};

export const Failed: Story = {
  args: {
    state: "failed",
    label: "The build stopped before finishing",
    action: wording.action.tryAgain,
  },
};

export const CommentsWorking: Story = {
  args: {
    state: "commentsWorking",
    label: "Working on 3 comments",
    action: pill.watch,
  },
};

export const CommentsDone: Story = {
  args: {
    state: "commentsDone",
    label: "3 comments done · Version 3",
    action: pill.seeChanges,
  },
};
