import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "../components.jsx";
import {
  ExportDialogView,
  ProjectInfoDialogView,
  ProjectMenuView,
  type ExportDialogViewProps,
  type ProjectInfoDialogViewProps,
} from "./project-menu.view.tsx";

// Holds what the dialog asks its host to keep: the name being typed.
function Info(args: ProjectInfoDialogViewProps) {
  const [name, setName] = useState(args.name);
  return <ProjectInfoDialogView {...args} name={name} onNameChange={setName} />;
}

const info: ProjectInfoDialogViewProps = {
  title: "Bakery orders",
  name: "Bakery orders",
  onNameChange: fn(),
  focusName: false,
  created: "3/14/2026, 9:26:53 AM",
  state: "active",
  canSave: false,
  saving: false,
  archiving: false,
  onSave: fn(),
  onToggleArchived: fn(),
  onClose: fn(),
};

const exporting: ExportDialogViewProps = {
  loading: false,
  failure: null,
  sections: [
    { section: "planning", available: true, chosen: true },
    { section: "design", available: true, chosen: true },
    { section: "build", available: false, chosen: false },
  ],
  onChoose: fn(),
  onExport: fn(),
  onClose: fn(),
};

const meta = {
  title: "Screens/Projects/Menu",
  component: ProjectMenuView,
  args: {
    trigger: <Button>Bakery orders</Button>,
    align: "start",
    archived: false,
    shipped: false,
    onShowInfo: fn(),
    onRename: fn(),
    onExport: fn(),
    onToggleShipped: fn(),
    onToggleArchived: fn(),
    onDelete: fn(),
    infoDialog: null,
    exportDialog: null,
  },
} satisfies Meta<typeof ProjectMenuView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Press the button to open the menu. */
export const Active: Story = {};

export const Shipped: Story = { args: { shipped: true } };

/** An archived project does not offer the shipped mark. */
export const Archived: Story = { args: { archived: true } };

export const ProjectInfo: Story = {
  args: { infoDialog: <Info {...info} /> },
};

export const Renaming: Story = {
  args: {
    infoDialog: <Info {...info} focusName name="Bakery order list" canSave />,
  },
};

export const SavingName: Story = {
  args: {
    infoDialog: <Info {...info} name="Bakery order list" canSave saving />,
  },
};

export const ArchivedProjectInfo: Story = {
  args: {
    archived: true,
    infoDialog: <Info {...info} state="archived" created={null} />,
  },
};

export const Export: Story = {
  args: { exportDialog: <ExportDialogView {...exporting} /> },
};

/** The project is still being asked what it has; nothing can be ticked yet. */
export const ExportReading: Story = {
  args: {
    exportDialog: (
      <ExportDialogView
        {...exporting}
        loading
        sections={exporting.sections.map(({ section }) => ({
          section,
          available: false,
          chosen: false,
        }))}
      />
    ),
  },
};

export const ExportCheckFailed: Story = {
  args: {
    exportDialog: (
      <ExportDialogView
        {...exporting}
        failure="Only the planning documents can be offered: the hub is unreachable."
        sections={[
          { section: "planning", available: true, chosen: true },
          { section: "design", available: false, chosen: false },
          { section: "build", available: false, chosen: false },
        ]}
      />
    ),
  },
};
