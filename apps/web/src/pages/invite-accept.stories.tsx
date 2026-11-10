import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InvitationAcceptView } from "./invite-accept.view.tsx";

const invited = {
  status: "invited",
  invitedBy: "ada@example.com",
  workspace: "northside-bakery",
  role: "Editor",
  email: "sam@example.com",
  state: "pending",
} as const;

const meta = {
  title: "Screens/Invitation",
  component: InvitationAcceptView,
  parameters: { layout: "fullscreen" },
  args: {
    invitation: invited,
    signedIn: true,
    accepting: false,
    onAccept: fn(),
    onSignIn: fn(),
    onOpenProjects: fn(),
  },
} satisfies Meta<typeof InvitationAcceptView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Invited: Story = {};

export const Opening: Story = { args: { invitation: { status: "opening" } } };

export const Unreadable: Story = {
  args: {
    invitation: {
      status: "unreadable",
      reason: "The hub refused the request: HTTP 404, invitation_not_found.",
    },
  },
};

/** Accepting needs an account, so the screen sends the person to sign in first. */
export const SignedOut: Story = { args: { signedIn: false } };

export const Accepting: Story = { args: { accepting: true } };

/** An invitation that is no longer pending says so and offers nothing. */
export const Expired: Story = {
  args: { invitation: { ...invited, state: "expired" } },
};

export const Accepted: Story = {
  args: { invitation: { status: "accepted", role: "Editor" } },
};

/** The role's name is a courtesy the hub may not let the invitee read. */
export const AcceptedWithoutRoleName: Story = {
  args: { invitation: { status: "accepted", role: null } },
};
