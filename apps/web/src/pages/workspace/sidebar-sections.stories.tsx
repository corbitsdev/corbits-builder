import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  SidebarSections,
  type SidebarSection,
  type SidebarSectionsProps,
} from "./sidebar-sections.tsx";

/** A section as the page would pass it, not on the page. */
const section = (
  id: string,
  label: string,
  status: string,
  tone?: "destructive",
): SidebarSection => ({ id, label, status, tone, selected: false });

export const preview = (status: string, tone?: "destructive") =>
  section("preview", "Preview", status, tone);
export const publish = (status: string) =>
  section("publish", "Publish", status);

// Holds what the page would: the section pressed last is the one on the page, so it is marked.
function Clickable(args: SidebarSectionsProps) {
  const [selected, setSelected] = useState(
    args.sections.find((each) => each.selected)?.id ?? null,
  );
  return (
    <SidebarSections
      sections={args.sections.map((each) => ({
        ...each,
        selected: each.id === selected,
      }))}
      onOpen={(id) => {
        setSelected(id);
        args.onOpen(id);
      }}
    />
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar/Sections",
  component: SidebarSections,
  args: {
    sections: [preview("Running"), publish("Live")],
    onOpen: fn(),
  },
  render: (args) => (
    <div
      style={{
        width: "calc(var(--rail-width) - 2 * var(--space-2))",
        padding: "var(--space-2)",
        background: "var(--card)",
      }}
    >
      <Clickable {...args} />
    </div>
  ),
} satisfies Meta<typeof SidebarSections>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished project: the preview runs and the app is live. A pressed row is marked. */
export const Finished: Story = {
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement).getByRole("button", { name: /^Publish/ });
    await userEvent.click(row);
    await expect(args.onOpen).toHaveBeenCalledWith("publish");
    await expect(row).toHaveAttribute("aria-current", "page");
  },
};

export const FinishedDark: Story = { globals: { mode: "dark" } };

/** A new project: nothing built yet, and no Publish row until there is something to publish. */
export const New: Story = { args: { sections: [preview("Not built")] } };

/** The preview could not start: its word is in the destructive colour. */
export const PreviewFailed: Story = {
  args: {
    sections: [preview("Failed", "destructive"), publish("Not published")],
  },
};

/** Every state the preview takes, one row each. */
export const PreviewStates: Story = {
  args: {
    sections: ["Not built", "Starting", "Running", "Stopped"].map((status) =>
      section(`preview-${status}`, "Preview", status),
    ),
  },
};
