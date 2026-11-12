import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  WorkingPreferencesView,
  type PreferenceRow,
  type WorkingPreferencesViewProps,
} from "./working-preferences.view.tsx";
import { WorkspaceApprovalsView } from "./workspace-approvals.view.tsx";
import workspaceApprovals from "./workspace-approvals.stories.tsx";

// Holds what the section asks its host to keep: each preference's choice.
function Section(args: WorkingPreferencesViewProps) {
  const [preferences, setPreferences] = useState(args.preferences);
  return (
    <WorkingPreferencesView
      {...args}
      preferences={preferences}
      onChoose={(id, choice) =>
        setPreferences(
          preferences.map((preference) =>
            preference.id === id
              ? { ...preference, choice, save: "saved" }
              : preference,
          ),
        )
      }
    />
  );
}

const row = {
  ends: null,
  save: null,
  disabled: false,
} as const;

const questions: PreferenceRow = {
  ...row,
  id: "questions",
  label: "Questions",
  group: "conversation",
  hint: "How much Builder asks before deciding for you.",
  options: [
    { id: "every_decision", label: "Every decision" },
    { id: "essentials", label: "Only essentials" },
    { id: "decide_for_me", label: "Decide for me" },
  ],
  choice: "essentials",
  ends: { start: "Asks more", end: "Asks less" },
};

const replies: PreferenceRow = {
  ...row,
  id: "replies",
  label: "Replies",
  group: "conversation",
  hint: "How much detail goes into what you read.",
  options: [
    { id: "concise", label: "Concise" },
    { id: "detailed", label: "Detailed" },
  ],
  choice: "concise",
};

const documents: PreferenceRow = {
  ...row,
  id: "agent_decides_approvals",
  label: "Documents",
  group: "reviews",
  hint: "Whether each document waits for your approval before the next.",
  options: [
    { id: "no", label: "You approve each" },
    { id: "yes", label: "Builder goes ahead" },
  ],
  choice: "no",
};

const designConcepts: PreferenceRow = {
  ...row,
  id: "design_concepts",
  label: "Design concepts",
  group: "reviews",
  hint: "How many different looks the designers make when you explore.",
  options: ["one", "two", "three", "four", "five"].map((id, index) => ({
    id,
    label: String(index + 1),
  })),
  choice: "three",
  ends: { start: "One look", end: "Five looks" },
};

const internet: PreferenceRow = {
  ...row,
  id: "internet_while_building",
  label: "Internet",
  group: "building",
  hint: "What the app builder can reach while it works.",
  options: [
    { id: "no", label: "npm registry only" },
    { id: "yes", label: "Any website" },
  ],
  choice: "yes",
};

const approvals: PreferenceRow = {
  ...row,
  id: "experimental_approvals",
  label: "Approval packages",
  group: "approvals",
  hint: "Whether projects share approval packages with reviewers.",
  options: [
    { id: "no", label: "Not used" },
    { id: "yes", label: "Share with reviewers" },
  ],
  choice: "no",
};

const meta = {
  title: "Screens/Settings/WorkingPreferences",
  component: WorkingPreferencesView,
  args: {
    preferences: [
      questions,
      replies,
      documents,
      designConcepts,
      internet,
      approvals,
    ],
    onChoose: fn(),
    fault: null,
    focusPreference: null,
    focusSeq: 0,
    reviewers: <WorkspaceApprovalsView {...workspaceApprovals.args} />,
  },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof WorkingPreferencesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

/** Until the hub answers, only the preferences it offers in advance are listed. */
export const Loading: Story = {
  args: { preferences: [approvals] },
};

export const Unreadable: Story = {
  args: {
    preferences: [approvals],
    fault: "The hub could not be reached.",
  },
};

/** Each change shows at once and saves as it is made; how that went is noted beside its name. */
export const Saving: Story = {
  args: {
    preferences: [
      { ...questions, save: "saving" },
      { ...replies, save: "failed" },
      { ...approvals, choice: "yes", save: "saved" },
    ],
  },
};

/** Sent here for one preference: it is scrolled to, focused and marked for a moment. */
export const SentToPreference: Story = {
  args: { focusPreference: "experimental_approvals" },
};
