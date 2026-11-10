import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  SharePackageView,
  type NewReviewer,
  type SharePackageViewProps,
} from "./share-package.view.tsx";

// Holds what the form asks its host to keep: the reviewer being entered and the expiry.
function Form(args: SharePackageViewProps) {
  const [reviewers, setReviewers] = useState(args.reviewers);
  const [expiry, setExpiry] = useState(args.expiry);
  const edit = (key: string, next: (reviewer: NewReviewer) => NewReviewer) =>
    setReviewers((current) =>
      current.map((reviewer) =>
        reviewer.key === key ? next(reviewer) : reviewer,
      ),
    );
  return (
    <SharePackageView
      {...args}
      reviewers={reviewers}
      expiry={expiry}
      onExpiryChange={setExpiry}
      onReviewerChange={(key, next) =>
        edit(key, (reviewer) => ({ ...reviewer, ...next }))
      }
      onSaveToWorkspaceChange={(key, saveToWorkspace) =>
        edit(key, (reviewer) => ({ ...reviewer, saveToWorkspace }))
      }
    />
  );
}

const blank: NewReviewer = {
  key: "reviewer-1",
  savedReviewer: "",
  name: "",
  persona: "",
  customPersona: null,
  goal: "",
  email: "",
  saveToWorkspace: false,
};

const meta = {
  title: "Screens/Workspace/AddReviewer",
  component: SharePackageView,
  args: {
    reviewers: [blank],
    savedReviewers: [],
    personas: ["Project owner", "Budget approver", "Technical approver", "CTO"],
    expiry: "7d",
    onExpiryChange: fn(),
    adding: false,
    canAdd: false,
    onReviewerChange: fn(),
    onPickSavedReviewer: fn(),
    onCommitCustomPersona: fn(),
    onSaveToWorkspaceChange: fn(),
    onAdd: fn(),
    onCancel: fn(),
  },
  render: (args) => <Form {...args} />,
} satisfies Meta<typeof SharePackageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {};

const priya: NewReviewer = {
  ...blank,
  name: "Priya Nair",
  persona: "Budget approver",
  goal: "Does the first release fit this quarter's budget?",
  email: "priya@example.com",
  saveToWorkspace: true,
};

export const Filled: Story = { args: { reviewers: [priya], canAdd: true } };

/** The hub is adding the reviewer; the form waits. */
export const Adding: Story = {
  args: { reviewers: [priya], canAdd: true, adding: true },
};

/** "Other…" opens a field for a persona of the person's own. */
export const EnteringCustomPersona: Story = {
  args: {
    reviewers: [
      { ...blank, name: "Priya Nair", customPersona: "Head of Support" },
    ],
    canAdd: true,
  },
};

/** A reviewer saved for every project fills the fields, and has no offer to save them again. */
export const PickedFromWorkspace: Story = {
  args: {
    savedReviewers: [
      { id: "ws-rev-jordan-lee", name: "Jordan Lee", persona: "CTO" },
      { id: "ws-rev-sam-ortiz", name: "Sam Ortiz", persona: "Budget approver" },
    ],
    reviewers: [
      {
        ...blank,
        savedReviewer: "ws-rev-jordan-lee",
        name: "Jordan Lee",
        persona: "CTO",
        goal: "Is the plan buildable in a quarter?",
        saveToWorkspace: null,
      },
    ],
    canAdd: true,
  },
};
