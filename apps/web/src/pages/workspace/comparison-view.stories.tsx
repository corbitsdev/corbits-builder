import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ComparisonView } from "./comparison-view.tsx";

const meta = {
  title: "Components/Workspace/ComparisonView",
  component: ComparisonView,
  args: {
    before:
      "## Problem\n\nBakeries take orders by phone.\n\n- Orders get lost\n- Staff are interrupted\n",
    after:
      "## Problem\n\nBakeries take orders by phone and on paper.\n\n- Orders get lost on busy days\n- Owners want one list\n",
    beforeVersion: 1,
    afterVersion: 2,
    prose: true,
    onClose: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ComparisonView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Prose marks changes inline, like tracked changes. */
export const Prose: Story = {};

/** Anything that isn't prose compares line by line. */
export const Lines: Story = { args: { prose: false } };
