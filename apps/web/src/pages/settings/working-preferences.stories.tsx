import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  WorkingPreferencesView,
  type PreferenceRow,
  type WorkingPreferencesViewProps,
} from "./working-preferences.view.tsx";

// Holds what the section asks its host to keep: each preference's choice.
function Section(args: WorkingPreferencesViewProps) {
  const [preferences, setPreferences] = useState(args.preferences);
  return (
    <WorkingPreferencesView
      {...args}
      preferences={preferences}
      onSwitch={(id, on) =>
        setPreferences(
          preferences.map((preference) =>
            preference.id === id && preference.kind === "switch"
              ? { ...preference, on, save: "saved" }
              : preference,
          ),
        )
      }
      onChoose={(id, choice) =>
        setPreferences(
          preferences.map((preference) =>
            preference.id === id && preference.kind === "list"
              ? { ...preference, choice, save: "saved" }
              : preference,
          ),
        )
      }
    />
  );
}

const approvals: PreferenceRow = {
  id: "experimental_approvals",
  label: "Approvals (experimental)",
  hint: "On, share tailored approval packages with stakeholders.",
  kind: "switch",
  on: false,
  save: null,
  disabled: false,
};

const questions: PreferenceRow = {
  id: "questions",
  label: "Questions before work starts",
  hint: "How much Builder asks before it writes.",
  kind: "list",
  options: [
    { id: "few", label: "Only what it must" },
    { id: "some", label: "A few" },
    { id: "many", label: "Everything it wonders" },
  ],
  choice: "some",
  save: null,
  disabled: false,
};

const plainLanguage: PreferenceRow = {
  id: "plain_language",
  label: "Plain language",
  hint: undefined,
  kind: "switch",
  on: true,
  save: null,
  disabled: false,
};

const meta = {
  title: "Screens/Settings/WorkingPreferences",
  component: WorkingPreferencesView,
  args: {
    preferences: [questions, plainLanguage, approvals],
    onSwitch: fn(),
    onChoose: fn(),
    fault: null,
    focusPreference: null,
    focusSeq: 0,
  },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof WorkingPreferencesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

/** Until the hub answers, only the preference this browser keeps is listed. */
export const Loading: Story = {
  args: { preferences: [approvals] },
};

export const Unreadable: Story = {
  args: { preferences: [approvals], fault: "The hub could not be reached." },
};

/** Each change saves as it is made, and says how that went beside its control. */
export const Saving: Story = {
  args: {
    preferences: [
      { ...questions, save: "saving", disabled: true },
      { ...plainLanguage, save: "failed" },
      { ...approvals, on: true, save: "saved" },
    ],
  },
};

/** Sent here for one preference: it is scrolled to, focused and marked for a moment. */
export const SentToPreference: Story = {
  args: { focusPreference: "experimental_approvals" },
};
