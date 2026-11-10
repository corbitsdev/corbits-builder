import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { NextStepLineView } from "./next-step.view.tsx";

const meta = {
  title: "Screens/Workspace/NextStepLine",
  component: NextStepLineView,
  parameters: { layout: "fullscreen" },
  args: {
    busy: false,
    now: "Nobody is working.",
    next: "Reply to the coordinator's question.",
    action: null,
  },
} satisfies Meta<typeof NextStepLineView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The step is the person's, and the workspace has a control for it. */
export const YourTurn: Story = {
  args: { action: { label: "Reply", onSelect: fn() } },
};

/** The step names no control the workspace has, so the line is words alone. */
export const WordsOnly: Story = {};

export const AgentsAtWork: Story = {
  args: {
    busy: true,
    now: "The app builder is working.",
    next: "Wait for the app, then try it.",
  },
};

/** A long step is cut at the line's end and read in full from its title. */
export const LongStep: Story = {
  args: {
    busy: true,
    now: "The writer is drafting the product requirements and the reviewer is reading the constraints.",
    next: "Approve the problem brief once you have read the reviewer's notes on it, or say what should change.",
    action: { label: "Open the app", onSelect: fn() },
  },
};
