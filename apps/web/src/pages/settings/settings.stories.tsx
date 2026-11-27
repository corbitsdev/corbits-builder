import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { CollaboratorsView } from "./collaborators.view.tsx";
import collaborators from "./collaborators.stories.tsx";
import { ProfilesView } from "./profiles.view.tsx";
import profiles from "./profiles.stories.tsx";
import { ProvidersSectionView } from "./providers.view.tsx";
import providers from "./providers.stories.tsx";
import { SecretsSectionView } from "./secrets.view.tsx";
import secrets from "./secrets.stories.tsx";
import { SettingsView, type SettingsViewProps } from "./settings.view.tsx";
import { WorkingPreferencesView } from "./working-preferences.view.tsx";
import workingPreferences from "./working-preferences.stories.tsx";

// Holds what the page asks its host to keep: the open tab and the look.
function Page(args: SettingsViewProps) {
  const [tab, setTab] = useState(args.tab);
  const [appearance, setAppearance] = useState(args.appearance);
  return (
    <SettingsView
      {...args}
      tab={tab}
      onTabChange={setTab}
      appearance={{
        ...appearance,
        onThemeChange: (theme) => setAppearance({ ...appearance, theme }),
        onDocumentTipsChange: (documentTips) =>
          setAppearance({ ...appearance, documentTips }),
      }}
    />
  );
}

const account = {
  name: "Ada Park",
  email: "ada@example.com",
  signingOut: false,
  onSignOut: fn(),
};

const meta = {
  title: "Screens/Settings/Settings",
  component: SettingsView,
  parameters: { layout: "fullscreen" },
  args: {
    tab: "providers",
    onTabChange: fn(),
    preferencesLoad: { state: "ready" },
    providers: <ProvidersSectionView {...providers.args} />,
    profiles: <ProfilesView {...profiles.args} />,
    collaborators: <CollaboratorsView {...collaborators.args} />,
    secrets: <SecretsSectionView {...secrets.args} />,
    workingPreferences: <WorkingPreferencesView {...workingPreferences.args} />,
    appearance: {
      theme: "system",
      onThemeChange: fn(),
      documentTips: true,
      onDocumentTipsChange: fn(),
    },
    account,
    back: { to: "Bakery orders", onBack: fn() },
  },
  render: (args) => <Page {...args} />,
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Providers: Story = {};

/** The arrow returns to where Settings came from, and so does Escape. */
export const Back: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Back to Bakery orders" }),
    );
    await expect(args.back?.onBack).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    await expect(args.back?.onBack).toHaveBeenCalledTimes(2);
  },
};

export const Profiles: Story = { args: { tab: "profiles" } };

export const Preferences: Story = { args: { tab: "preferences" } };

/** The person's own sign-out is on its way to the hub. */
export const SigningOut: Story = {
  args: { tab: "preferences", account: { ...account, signingOut: true } },
};

/** Nobody is signed in, so the Preferences tab ends at Appearance. */
export const PreferencesSignedOut: Story = {
  args: { tab: "preferences", account: null },
};

export const Collaborators: Story = { args: { tab: "collaborators" } };

export const Secrets: Story = { args: { tab: "secrets" } };

export const About: Story = { args: { tab: "about" } };

export const PreferencesLoading: Story = {
  args: { tab: "preferences", preferencesLoad: { state: "loading" } },
};

export const PreferencesReadFailed: Story = {
  args: {
    tab: "preferences",
    preferencesLoad: {
      state: "failed",
      fault: "Service Unavailable",
      onRetry: fn(),
    },
  },
};
