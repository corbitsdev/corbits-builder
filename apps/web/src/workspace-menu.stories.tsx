import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  CreateWorkspaceDialogView,
  WorkspaceMenuView,
  type CreateWorkspaceDialogViewProps,
} from "./workspace-menu.view.tsx";

const meta = {
  title: "Screens/Shell/WorkspaceMenu",
  component: WorkspaceMenuView,
  args: {
    name: "Acme product team",
    workspaces: [
      { id: "acme", name: "Acme product team", open: true },
      { id: "side", name: "Side projects", open: false },
      { id: "client", name: "Northwind client work", open: false },
    ],
    onOpen: fn(),
    onCreate: fn(),
  },
} satisfies Meta<typeof WorkspaceMenuView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspaces: Story = {};

/** Until the hub has listed the workspaces, the rail shows the product's name. */
export const ListUnread: Story = { args: { name: "Builder", workspaces: [] } };

// Holds what the dialog asks its host to keep: the name being typed.
function CreateDialog(args: Partial<CreateWorkspaceDialogViewProps>) {
  const [name, setName] = useState("");
  return (
    <CreateWorkspaceDialogView
      name={name}
      onNameChange={setName}
      creating={false}
      created={null}
      onCreate={fn()}
      onClose={fn()}
      {...args}
    />
  );
}

export const NamingWorkspace: Story = { render: () => <CreateDialog /> };

export const CreatingWorkspace: Story = {
  render: () => <CreateDialog name="Side projects" creating />,
};

export const WorkspaceCreated: Story = {
  render: () => (
    <CreateDialog created={{ name: "Side projects", onOpen: fn() }} />
  ),
};
