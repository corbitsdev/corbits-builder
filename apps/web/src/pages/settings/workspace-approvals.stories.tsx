import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import type { ReviewerDraft } from "../approval-fields.tsx";
import {
  WorkspaceApprovalsView,
  type WorkspaceApprovalsViewProps,
} from "./workspace-approvals.view.tsx";

// Holds what the section asks its host to keep: the switch and the reviewer being entered.
function Section(args: WorkspaceApprovalsViewProps) {
  const [required, setRequired] = useState(args.required);
  const [reviewer, setReviewer] = useState(args.reviewer);
  return (
    <WorkspaceApprovalsView
      {...args}
      required={required}
      onRequiredChange={setRequired}
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
    required: true,
    onRequiredChange: fn(),
    reviewers: [],
    onRemoveReviewer: fn(),
    personas: ["Project owner", "Budget approver", "Technical approver", "CTO"],
    reviewer: blank,
    onReviewerChange: fn(),
    canAdd: false,
    onAddReviewer: fn(),
  },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof WorkspaceApprovalsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoReviewers: Story = {};

/** Approval packages are bypassed; the saved reviewers stay. */
export const NotRequired: Story = { args: { required: false } };

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
    reviewer: {
      ...blank,
      name: "Priya Nair",
      customPersona: "Head of Support",
      goal: "Will this cut ticket volume?",
    },
    canAdd: true,
  },
};
