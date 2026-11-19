import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import {
  ServerKeyFormView,
  type ServerKeyFormViewProps,
} from "@corbits-builder/plugin-ui/server-key-form";

const PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk0dGVzdGtleWZvcnN0b3J5Ym9va29ubHkxMjM0NTY3OA plugin.server";

// The address as the person types it, kept here the way the form keeps it.
function NewServer(props: {
  publicKey: string | undefined;
  saving: boolean;
  fault: string | undefined;
  onConnect: () => void;
  onNewKey?: () => void;
}) {
  const [address, setAddress] = useState("");
  return (
    <ServerKeyFormView
      about="Your server"
      stage={{
        step: "new",
        publicKey: props.publicKey,
        address,
        onAddress: setAddress,
        onConnect: props.onConnect,
        onNewKey: props.onNewKey ?? fn(),
        saving: props.saving,
      }}
      fault={props.fault}
      onFault={fn()}
    />
  );
}

const meta = {
  title: "Screens/Plugins/Server key form",
  component: ServerKeyFormView,
  args: {
    about: "Your server",
    stage: { step: "reading" },
    fault: undefined,
    onFault: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "36rem", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ServerKeyFormView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** While the form reads whether the project already has a server. */
export const Reading: Story = {};

const onNewKey = fn();

/**
 * A new server: the key to give the hosting provider, a note that the key is kept until the server
 * is connected, and the address. The keyboard reaches the key, Copy, then the address. Connect is
 * disabled until there is an address, and a new key can be made instead.
 */
export const NewServerKey: Story = {
  render: () => (
    <NewServer
      publicKey={PUBLIC_KEY}
      saving={false}
      fault={undefined}
      onConnect={fn()}
      onNewKey={onNewKey}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole("button", { name: "Connect" }),
    ).toBeDisabled();
    await expect(
      canvas.getByText(/stays the same if you leave and come back/),
    ).toBeVisible();
    await userEvent.tab();
    await expect(
      canvas.getByLabelText("The key to give your hosting provider"),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Copy" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByLabelText("Server address")).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("button", { name: "Make a new key" }),
    );
    await expect(onNewKey).toHaveBeenCalled();
  },
};

/** The hub is still making the key. */
export const Making: Story = {
  render: () => (
    <NewServer
      publicKey={undefined}
      saving={false}
      fault={undefined}
      onConnect={fn()}
    />
  ),
};

/** Connecting failed for a reason the form has no wording for. */
export const NotSaved: Story = {
  render: () => (
    <NewServer
      publicKey={PUBLIC_KEY}
      saving={false}
      fault="Not connected. Try again in a moment."
      onConnect={fn()}
    />
  ),
};

/** The server answered but refused the key, because the key is not on the server yet. */
export const KeyNotAccepted: Story = {
  render: () => (
    <NewServer
      publicKey={PUBLIC_KEY}
      saving={false}
      fault="The server didn't accept the key yet. Add it at your hosting provider, then try again."
      onConnect={fn()}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      /didn't accept the key yet/,
    );
  },
};

const saved = (
  onUse: () => void,
  onAnother: () => void,
): ServerKeyFormViewProps["stage"] => ({
  step: "saved",
  saved: { address: "203.0.113.5", publicKey: PUBLIC_KEY },
  onUse,
  onAnother,
});

/** The project already has a server: its address and saved key, and a way to connect another. */
export const SavedServer: Story = {
  args: { stage: saved(fn(), fn()) },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText("203.0.113.5")).toBeVisible();
    await expect(
      canvas.getByLabelText("The key to give your hosting provider"),
    ).toHaveValue(PUBLIC_KEY);
    await expect(canvas.queryByText(/stays the same/)).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Connect a different server" }),
    );
    if (args.stage.step === "saved")
      await expect(args.stage.onAnother).toHaveBeenCalled();
  },
};
