import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import type { ReviewerDraft } from "../approval-fields.tsx";
import {
  WorkspaceApprovalsView,
  type WorkspaceApprovalsViewProps,
} from "./workspace-approvals.view.tsx";

// Holds what the section asks its host to keep: the open dialog and the reviewer being entered.
function Section(args: WorkspaceApprovalsViewProps) {
  const [adding, setAdding] = useState(args.adding);
  const [reviewer, setReviewer] = useState(args.reviewer);
  return (
    <WorkspaceApprovalsView
      {...args}
      adding={adding}
      onAddingChange={setAdding}
      reviewer={reviewer}
      onReviewerChange={setReviewer}
    />
  );
}

const blank: ReviewerDraft = {
  name: "",
  persona: "Project owner",
  customPersona: null,
  goal: "",
  email: "",
};

const meta = {
  title: "Screens/Settings/WorkspaceApprovals",
  component: WorkspaceApprovalsView,
  args: {
    reviewers: [],
    onRemoveReviewer: fn(),
    personas: ["Project owner", "Budget approver", "Technical approver", "CTO"],
    reviewer: blank,
    onReviewerChange: fn(),
    adding: false,
    onAddingChange: fn(),
    canAdd: false,
    onAddReviewer: fn(),
  },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof WorkspaceApprovalsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoReviewers: Story = {};

export const SavedReviewers: Story = {
  args: {
    reviewers: [
      {
        id: "ws-rev-jordan-lee",
        name: "Jordan Lee",
        persona: "CTO",
        goal: "Is the plan buildable in a quarter?",
        email: "jordan@example.com",
      },
      { id: "ws-rev-sam-ortiz", name: "Sam Ortiz", persona: "Budget approver" },
    ],
  },
};

/** "Other…" opens a field for a persona of the person's own. */
export const EnteringCustomPersona: Story = {
  args: {
    adding: true,
    reviewer: {
      ...blank,
      name: "Priya Nair",
      customPersona: "Head of Support",
      goal: "Will this cut ticket volume?",
    },
    canAdd: true,
  },
};
