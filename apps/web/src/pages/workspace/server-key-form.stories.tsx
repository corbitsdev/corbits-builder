import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { ServerKeyFormView } from "@corbits-builder/plugin-ui/server-key-form";

const PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk0dGVzdGtleWZvcnN0b3J5Ym9va29ubHkxMjM0NTY3OA plugin.server";

// The address as the person types it, kept here the way the form keeps it.
function NewServer(props: {
  publicKey: string | undefined;
  fault?: string;
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
        onConnect: fn(),
        onNewKey: props.onNewKey ?? fn(),
        saving: false,
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
  render: () => <NewServer publicKey={PUBLIC_KEY} onNewKey={onNewKey} />,
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.getByRole("button", { name: "Connect" }),
    ).toBeDisabled();
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
  render: () => <NewServer publicKey={undefined} />,
};

/** Connecting failed for a reason the form has no wording for. */
export const NotSaved: Story = {
  render: () => (
    <NewServer
      publicKey={PUBLIC_KEY}
      fault="Not connected. Try again in a moment."
    />
  ),
};

/** The server answered but refused the key, because the key is not on the server yet. */
export const KeyNotAccepted: Story = {
  render: () => (
    <NewServer
      publicKey={PUBLIC_KEY}
      fault="The server didn't accept the key yet. Add it at your hosting provider, then try again."
    />
  ),
};

/** The project already has a server: its address and saved key, and a way to connect another. */
export const SavedServer: Story = {
  args: {
    stage: {
      step: "saved",
      saved: { address: "203.0.113.5", publicKey: PUBLIC_KEY },
      onUse: fn(),
      onAnother: fn(),
    },
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Connect a different server" }),
    );
    if (args.stage.step === "saved")
      await expect(args.stage.onAnother).toHaveBeenCalled();
  },
};
