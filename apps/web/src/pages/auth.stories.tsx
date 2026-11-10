import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { AuthView, type AuthViewProps } from "./auth.view.tsx";

// Holds what the page asks its host to keep: which of the two forms is showing.
function Page(args: AuthViewProps) {
  const [mode, setMode] = useState(args.mode);
  return <AuthView {...args} mode={mode} onModeChange={setMode} />;
}

const meta = {
  title: "Screens/SignIn",
  component: AuthView,
  parameters: { layout: "fullscreen" },
  args: {
    mode: "sign-in",
    onModeChange: fn(),
    busy: false,
    error: null,
    onSubmit: fn(),
  },
  render: (args) => <Page {...args} />,
} satisfies Meta<typeof AuthView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};

export const SignUp: Story = { args: { mode: "sign-up" } };

/** The hub is checking the credentials; the form and the switch wait. */
export const SigningIn: Story = { args: { busy: true } };

export const Refused: Story = {
  args: { error: "Invalid email or password" },
};

export const PasswordTooShort: Story = {
  args: {
    mode: "sign-up",
    error: "Use at least 8 characters for the password.",
  },
};
