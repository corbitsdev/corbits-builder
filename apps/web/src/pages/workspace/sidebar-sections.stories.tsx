import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  SidebarSections,
  type SidebarSection,
  type SidebarSectionsProps,
} from "./sidebar-sections.tsx";
import { LIVE_TAB, MANUAL_TAB } from "./tab-follow.ts";

/** The room's one section, as it passes it once there is an app: the preview, not on the page. */
export const preview: SidebarSection = {
  id: LIVE_TAB,
  label: wording.projectShell.preview,
  selected: false,
};

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
    sections: [preview],
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

/** The Preview row opens the app; once pressed, it is marked as the page. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement).getByRole("button", {
      name: wording.projectShell.preview,
    });
    await userEvent.click(row);
    await expect(args.onOpen).toHaveBeenCalledWith(LIVE_TAB);
    await expect(row).toHaveAttribute("aria-current", "page");
  },
};

export const Dark: Story = { globals: { mode: "dark" } };

/** Once the hub has the app's user manual, a row under Preview opens it. */
export const WithUserManual: Story = {
  args: {
    sections: [
      preview,
      {
        id: MANUAL_TAB,
        label: wording.projectShell.userManual,
        selected: false,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.projectShell.userManual,
      }),
    );
    await expect(args.onOpen).toHaveBeenCalledWith(MANUAL_TAB);
  },
};
