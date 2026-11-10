import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EnableAiDialogView, ModelSetupView } from "./model-setup.view.tsx";

const providers = {
  fault: null,
  tiles: {
    logins: [
      { id: "codex", label: "ChatGPT", hint: "Your Plus or Pro plan" },
      { id: "xai", label: "Grok", hint: "Your SuperGrok plan" },
    ],
    apiKeys: [
      { id: "anthropic", label: "Anthropic", hint: "Claude models" },
      { id: "openai", label: "OpenAI", hint: "GPT models" },
      { id: "google", label: "Google", hint: "Gemini models" },
    ],
  },
  signingIn: null,
  onSignIn: fn(),
  onAddKey: fn(),
};

const meta = {
  title: "Screens/ModelSetup",
  component: ModelSetupView,
  parameters: { layout: "fullscreen" },
  args: { providers, onLater: fn() },
} satisfies Meta<typeof ModelSetupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Providers: Story = {};

/** The hub has not said which providers exist yet. */
export const Reading: Story = {
  args: { providers: { ...providers, tiles: null } },
};

export const Unreadable: Story = {
  args: {
    providers: {
      ...providers,
      tiles: null,
      fault: "The hub is unreachable.",
    },
  },
};

/** A refetch failed; the tiles the last read left stay under the fault. */
export const UnreadableAfterARead: Story = {
  args: { providers: { ...providers, fault: "The hub is unreachable." } },
};

/** The person is signing in on the provider's tab; every tile waits. */
export const SigningIn: Story = {
  args: { providers: { ...providers, signingIn: "codex" } },
};

const onOpenChange = fn();

/** The same tiles over an open project. */
export const OverAProject: Story = {
  render: ({ providers }) => (
    <EnableAiDialogView
      open
      onOpenChange={onOpenChange}
      providers={providers}
    />
  ),
};
