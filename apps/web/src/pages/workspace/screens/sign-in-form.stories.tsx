import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import {
  SignInFormView,
  type SignInFormViewProps,
} from "@corbits-builder/plugin-ui/sign-in-form";

const SIGN_IN_URL =
  "https://hoster.example/oauth/authorize?response_type=code&state=story";

const signedOut = (lapsed: boolean): SignInFormViewProps["stage"] => ({
  step: "signedOut",
  lapsed,
  onSignIn: fn(),
  starting: false,
});

const signedIn = (
  account: string | undefined,
): SignInFormViewProps["stage"] => ({
  step: "signedIn",
  account,
  onUse: fn(),
  onSignInAgain: fn(),
  onDisconnect: fn(),
  starting: false,
  disconnecting: false,
});

const meta = {
  title: "Screens/Plugins/Sign-in form",
  component: SignInFormView,
  args: {
    about: "Hoster account",
    stage: { step: "reading" },
    warning: undefined,
    fault: undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "36rem", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SignInFormView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** While the form reads whether the project is already signed in. */
export const Reading: Story = {};

/** Nothing saved yet: one button, which says where the sign-in opens. */
export const SignIn: Story = {
  args: { stage: signedOut(false) },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Sign in" });
    await expect(button).toHaveAccessibleDescription(
      /The sign-in page opens in a new tab/,
    );
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    if (args.stage.step === "signedOut")
      await expect(args.stage.onSignIn).toHaveBeenCalled();
  },
};

/** The provider stopped accepting the saved sign-in, for example by refusing a refresh. */
export const SignedOutAtProvider: Story = {
  args: { stage: signedOut(true) },
};

/**
 * The person is signing in on the provider's tab. The page can be opened again if the browser
 * blocked it, or the wait cancelled.
 */
export const Waiting: Story = {
  args: { stage: { step: "waiting", url: SIGN_IN_URL, onCancel: fn() } },
};

/** Signed in: the account the provider named, and what the person can do next. */
export const SignedIn: Story = {
  args: { stage: signedIn("Acme team") },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Use this account" }),
    );
    if (args.stage.step === "signedIn")
      await expect(args.stage.onUse).toHaveBeenCalled();
  },
};

/** A provider that names no account still says the project is signed in. */
export const SignedInNoAccount: Story = {
  args: { stage: signedIn(undefined) },
};

/** While something billable exists, the screen says so above Disconnect, which asks twice. */
export const DisconnectWithWarning: Story = {
  args: {
    stage: signedIn("Acme team"),
    warning:
      "A server rented for this project still costs $6 a month. Disconnecting does not remove it.",
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Disconnect" }));
    if (args.stage.step === "signedIn")
      await expect(args.stage.onDisconnect).not.toHaveBeenCalled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Yes, disconnect" }),
    );
    if (args.stage.step === "signedIn")
      await expect(args.stage.onDisconnect).toHaveBeenCalled();
  },
};

/** The sign-in came back to a browser not signed in to Builder as the person who started it. */
export const OtherSession: Story = {
  args: {
    stage: signedOut(false),
    fault:
      "The sign-in came back to a browser that is not signed in as you. Sign in again from this browser.",
  },
};

/** Disconnected here, but the provider did not confirm it revoked the grant. */
export const ProviderMayHold: Story = {
  args: {
    stage: signedOut(false),
    fault:
      "Disconnected here. The provider may still hold the sign-in: remove it in your account there.",
  },
};
