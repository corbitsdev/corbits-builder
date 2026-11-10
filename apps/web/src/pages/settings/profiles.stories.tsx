import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ProfilesView,
  type EditorTier,
  type ProfileEditorProps,
  type ProfileRow,
  type ProfilesViewProps,
  type TierBinding,
} from "./profiles.view.tsx";

function runs(
  provider: string,
  [low, medium, high, max]: [string, string, string, string],
): TierBinding[] {
  return [
    {
      id: "low",
      label: "Low",
      roles: ["Coordinator"],
      model: low,
      provider,
      effort: "Medium",
    },
    {
      id: "medium",
      label: "Medium",
      roles: ["Product manager", "Designer"],
      model: medium,
      provider,
      effort: "Medium",
    },
    {
      id: "high",
      label: "High",
      roles: ["Architect", "App builder"],
      model: high,
      provider,
      effort: "High",
    },
    {
      id: "max",
      label: "Max",
      roles: [],
      model: max,
      provider,
      effort: "High",
    },
  ];
}

const claude: ProfileRow = {
  id: "anthropic_default",
  label: "Claude",
  hint: "Anthropic's models, balanced for most projects.",
  own: false,
  active: true,
  runnable: true,
  tiers: runs("Anthropic", ["Haiku", "Sonnet", "Opus", "Opus"]),
};
const gpt: ProfileRow = {
  id: "openai_default",
  label: "GPT",
  hint: "OpenAI's models.",
  own: false,
  active: false,
  runnable: true,
  tiers: runs("OpenAI", ["GPT mini", "GPT", "GPT", "GPT pro"]),
};
const grok: ProfileRow = {
  id: "xai_default",
  label: "Grok",
  hint: "xAI's models.",
  own: false,
  active: false,
  runnable: false,
  tiers: runs("xAI", ["Grok", "Grok", "Grok", "Grok"]),
};
const mine: ProfileRow = {
  id: "custom_weekend",
  label: "Weekend build",
  hint: undefined,
  own: true,
  active: false,
  runnable: true,
  tiers: runs("OpenAI", ["GPT mini", "GPT mini", "GPT", "GPT"]),
};

const list = {
  profiles: [claude, gpt, grok, mine],
  notice: null,
  onNew: fn(),
  onEdit: fn(),
  onDelete: fn(),
  onUse: fn(),
};

const providers = [
  { id: "anthropic", label: "Anthropic", connected: true },
  { id: "openai", label: "OpenAI", connected: true },
];
const models = [
  { id: "small", label: "Small" },
  { id: "large", label: "Large" },
];
const blankTiers: EditorTier[] = claude.tiers.map(({ id, label }) => ({
  id,
  label,
  provider: "",
  providers,
  model: "",
  models: null,
  effort: "",
}));
const filledTiers: EditorTier[] = blankTiers.map((tier) => ({
  ...tier,
  provider: "openai",
  model: "large",
  models,
  effort: "medium",
}));

const editor: ProfileEditorProps = {
  mode: "new",
  startFrom: [claude, gpt, mine].map(({ id, label }) => ({ id, label })),
  onStartFrom: fn(),
  name: "",
  onNameChange: fn(),
  tiers: blankTiers,
  onProviderChange: fn(),
  onModelChange: fn(),
  onEffortChange: fn(),
  efforts: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
  replacing: "Claude",
  makeDefault: false,
  onMakeDefaultChange: fn(),
  saving: false,
  canSave: false,
  onSave: fn(),
  onCancel: fn(),
};

// Holds what the editor asks its host to keep: the name being typed and the switch.
function Section(args: ProfilesViewProps) {
  const [editor, setEditor] = useState(args.editor);
  return (
    <ProfilesView
      {...args}
      editor={
        editor && {
          ...editor,
          onNameChange: (name) => setEditor({ ...editor, name }),
          onMakeDefaultChange: (makeDefault) =>
            setEditor({ ...editor, makeDefault }),
        }
      }
    />
  );
}

const meta = {
  title: "Screens/Settings/Profiles",
  component: ProfilesView,
  args: { profilesFault: null, choiceFault: null, list, editor: null },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof ProfilesView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Details" on a row shows what that profile runs instead of the active one. */
export const Listed: Story = {};

/** The hub has not sent the profiles yet. */
export const Loading: Story = { args: { list: null } };

export const Unreadable: Story = {
  args: { list: null, profilesFault: "The hub could not be reached." },
};

/** Several providers are connected and none is chosen, so nothing is active. */
export const NothingActive: Story = {
  args: {
    list: {
      ...list,
      profiles: [{ ...claude, active: false }, gpt, grok, mine],
      notice: "Choose a profile: more than one provider is connected.",
    },
  },
};

export const SaveFailed: Story = {
  args: { choiceFault: "That did not save. Try again." },
};

export const NewProfile: Story = { args: { editor } };

export const NewProfileFilledIn: Story = {
  args: {
    editor: {
      ...editor,
      name: "GPT copy",
      tiers: filledTiers,
      makeDefault: true,
      canSave: true,
    },
  },
};

export const SavingProfile: Story = {
  args: {
    editor: {
      ...editor,
      name: "GPT copy",
      tiers: filledTiers,
      saving: true,
      canSave: true,
    },
  },
};

/** A tier still on a provider that is no longer connected has to be moved before saving. */
export const EditProfile: Story = {
  args: {
    editor: {
      ...editor,
      mode: "edit",
      name: "Weekend build",
      replacing: null,
      tiers: filledTiers.map((tier) =>
        tier.id === "max"
          ? {
              ...tier,
              provider: "xai",
              providers: [
                { id: "xai", label: "xAI", connected: false },
                ...providers,
              ],
              model: "grok",
              models: [{ id: "grok", label: "Grok" }],
            }
          : tier,
      ),
    },
  },
};
