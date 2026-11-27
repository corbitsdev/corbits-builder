import type { Meta, StoryObj } from "@storybook/react-vite";
import { wording } from "../config.ts";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "../components.jsx";
import {
  ExportDialogView,
  RenameDialogView,
  ProjectMenuView,
  type ExportDialogViewProps,
  type RenameDialogViewProps,
} from "./project-menu.view.tsx";

// Holds what the dialog asks its host to keep: the name being typed.
function Rename(args: RenameDialogViewProps) {
  const [name, setName] = useState(args.name);
  return <RenameDialogView {...args} name={name} onNameChange={setName} />;
}

const rename: RenameDialogViewProps = {
  name: "Bakery orders",
  onNameChange: fn(),
  canSave: false,
  saving: false,
  onSave: fn(),
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
    side: "bottom",
    sideOffset: 4,
    archived: false,
    shipped: false,
    onRename: fn(),
    onExport: fn(),
    onToggleShipped: fn(),
    onToggleArchived: fn(),
    onDelete: fn(),
    renameDialog: null,
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

export const Renaming: Story = {
  args: { renameDialog: <Rename {...rename} /> },
};

export const Renamed: Story = {
  args: {
    renameDialog: <Rename {...rename} name="Bakery order list" canSave />,
  },
};

export const SavingName: Story = {
  args: {
    renameDialog: (
      <Rename {...rename} name="Bakery order list" canSave saving />
    ),
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
        failure={`Only the documents can be offered: ${wording.auth.unreachable}`}
        sections={[
          { section: "planning", available: true, chosen: true },
          { section: "design", available: false, chosen: false },
          { section: "build", available: false, chosen: false },
        ]}
      />
    ),
  },
};
