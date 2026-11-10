import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  CollaboratorsView,
  type CollaboratorsViewProps,
} from "./collaborators.view.tsx";

// Holds what the section asks its host to keep: the invitation being written.
function Section(args: CollaboratorsViewProps) {
  const [email, setEmail] = useState(args.email);
  const [roleId, setRoleId] = useState(args.roleId);
  return (
    <CollaboratorsView
      {...args}
      email={email}
      onEmailChange={setEmail}
      roleId={roleId}
      onRoleChange={setRoleId}
    />
  );
}

const roles = [
  { id: "role_owner", name: "Owner", description: "Everything" },
  { id: "role_editor", name: "Editor", description: "Works in projects" },
  { id: "role_viewer", name: "Viewer", description: null },
];

const meta = {
  title: "Screens/Settings/Collaborators",
  component: CollaboratorsView,
  args: {
    fault: null,
    notice: null,
    you: { name: "Ada Park", email: "ada@example.com" },
    yourRoles: ["Owner"],
    roles,
    email: "",
    onEmailChange: fn(),
    roleId: "",
    onRoleChange: fn(),
    busy: false,
    canInvite: false,
    onInvite: fn(),
    invitations: [],
    onRevoke: fn(),
  },
  render: (args) => <Section {...args} />,
} satisfies Meta<typeof CollaboratorsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoInvitations: Story = {};

/** The hub has not answered yet. */
export const Loading: Story = { args: { yourRoles: null, roles: null } };

export const Failed: Story = {
  args: {
    yourRoles: null,
    roles: null,
    fault: "Your role does not let you manage invitations.",
  },
};

/** With no roles there is nothing an invitation could grant. */
export const NoRoles: Story = { args: { yourRoles: [], roles: [] } };

const invitations = [
  { id: "inv_1", email: "lee@example.com", expires: "6 days left" },
  { id: "inv_2", email: "sam@example.com", expires: "1 day left" },
];

export const OpenInvitations: Story = { args: { invitations } };

export const ReadyToInvite: Story = {
  args: { email: "lee@example.com", roleId: "role_editor", canInvite: true },
};

/** An invitation is being made; the form and each Revoke wait. */
export const Inviting: Story = {
  args: {
    email: "lee@example.com",
    roleId: "role_editor",
    canInvite: true,
    busy: true,
    invitations: invitations.slice(1),
  },
};

export const Invited: Story = {
  args: {
    invitations,
    notice:
      "Invitation created for lee@example.com. Their link: https://builder.example.com/invite/9f2c — email delivery is not configured; share the link yourself.",
  },
};
