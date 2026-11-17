import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import { PassageQuotes } from "./passage-note.tsx";

const meta = {
  title: "Components/Workspace/PassageQuotes",
  component: PassageQuotes,
  args: {
    title: "Problem brief",
    version: 2,
    onAdd: fn(),
    children: (
      <Markdown
        source={
          "## Problem\n\nBakeries lose orders because they take them by phone.\n\nClick a passage to quote it into the message."
        }
      />
    ),
  },
} satisfies Meta<typeof PassageQuotes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking a passage offers to quote it. */
export const Quotable: Story = {};

/** Without `onAdd` the passages are plain reading. */
export const ReadOnly: Story = {
  render: ({ title, version, children }) => (
    <PassageQuotes title={title} version={version}>
      {children}
    </PassageQuotes>
  ),
};
