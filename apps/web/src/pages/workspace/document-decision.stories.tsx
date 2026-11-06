import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";

const meta = {
  title: "Components/Workspace/Decisions",
  component: DocumentDecision,
  args: {
    approval: {
      approvalId: "approval-1",
      document: { kind: "problem_brief", title: "Problem brief", version: 2 },
    },
    onYes: fn(),
    onAlways: fn(),
    onNo: fn(),
    onShowDocument: fn(),
  },
} satisfies Meta<typeof DocumentDecision>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AskingForADocument: Story = {};

export const DocumentShown: Story = {
  args: { shownDocument: "problem_brief" },
};

export const SeveralDocuments: Story = {
  args: {
    approval: {
      approvalId: "approval-2",
      sources: [
        { kind: "problem_brief", title: "Problem brief", version: 2 },
        {
          kind: "product_requirements",
          title: "Product requirements",
          version: 1,
        },
      ],
    },
  },
};

export const Approved: Story = {
  args: {
    approval: {
      approvalId: "approval-3",
      document: { kind: "problem_brief", title: "Problem brief", version: 2 },
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
