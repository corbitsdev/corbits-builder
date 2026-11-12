import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";

const meta = {
  title: "Components/Workspace/Decisions",
  component: DocumentDecision,
  args: {
    approval: {
      approvalId: "approval-1",
      toolName: "run_shell",
      subject: "bun run build",
    },
    onYes: fn(),
    onAlways: fn(),
    onNo: fn(),
  },
} satisfies Meta<typeof DocumentDecision>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AskingToUseATool: Story = {};

export const Approved: Story = {
  args: {
    approval: {
      approvalId: "approval-3",
      toolName: "run_shell",
      subject: "bun run build",
      outcome: { status: "approved", scope: "once" },
    },
  },
};

export const Failed: Story = {
  args: { error: "The decision didn't reach the hub. Try again." },
};

export const Packages: StoryObj<typeof PackageDecision> = {
  args: {
    approvalId: "approval-4",
    packages: ["react-router@7.9.1", "date-fns@4.1.0"],
    onYes: fn(),
    onAlways: fn(),
    onNo: fn(),
  },
  render: (args) => <PackageDecision {...args} />,
};
