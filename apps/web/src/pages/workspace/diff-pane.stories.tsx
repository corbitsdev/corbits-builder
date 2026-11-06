import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiffPane } from "./diff-pane.tsx";

const meta = {
  title: "Components/Workspace/DiffPane",
  component: DiffPane,
  args: {
    before: "# Brief\n\nBakeries take orders by phone.\nOrders get lost.\n",
    after:
      "# Brief\n\nBakeries take orders by phone and on paper.\nOrders get lost on busy days.\nOwners want one list.\n",
    beforeVersion: 1,
    afterVersion: 2,
  },
} satisfies Meta<typeof DiffPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Changes: Story = {};

/** The comparison header already names the versions. */
export const WithoutRange: Story = { args: { hideRange: true } };

export const NoEarlierVersion: Story = {
  args: { before: null, beforeVersion: null },
};
