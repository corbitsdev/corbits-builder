import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "./config.ts";
import { ProjectMenuView } from "./pages/project-menu.view.tsx";
import { SidebarHeader } from "./sidebar-header.tsx";
import { SidebarSurface } from "./sidebar-shell.tsx";

const words = wording.projectShell;

const meta = {
  title: "Screens/Workspace/ProjectSidebar/Header",
  component: SidebarHeader,
  args: {
    title: "Bakery orders",
    onHome: fn(),
    onPreferences: fn(),
  },
  render: (args) => (
    <div style={{ width: "var(--rail-width)" }}>
      <SidebarSurface>
        <SidebarHeader {...args} />
      </SidebarSurface>
    </div>
  ),
} satisfies Meta<typeof SidebarHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With no menu of its own, the name is only shown, with no chevron after it. */
export const NameOnly: Story = {};

export const NameOnlyDark: Story = { globals: { mode: "dark" } };

/**
 * The project's name opens the project's own menu, as its card on the projects page does; the
 * chevron after it says so.
 */
export const NameMenu: Story = {
  args: {
    titleMenu: (trigger, placement) => (
      <ProjectMenuView
        trigger={trigger}
        align="start"
        side="bottom"
        {...placement}
        archived={false}
        shipped={false}
        onRename={fn()}
        onExport={fn()}
        onToggleShipped={fn()}
        onToggleArchived={fn()}
        onDelete={fn()}
        renameDialog={null}
        exportDialog={null}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    within(canvasElement)
      .getByRole("button", { name: "Bakery orders", expanded: false })
      .focus();
    await userEvent.keyboard("{Enter}");
    await expect(
      within(document.body).getByRole("menuitem", { name: "Rename" }),
    ).toBeVisible();
  },
};

/** The mark opens a menu, from the keyboard too, back to the projects or to Settings. */
export const MarkMenu: Story = {
  play: async ({ args, canvasElement }) => {
    within(canvasElement).getByRole("button", { name: words.menu }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = within(document.body);
    await expect(
      menu.getByRole("menuitem", { name: wording.settings.tab.preferences }),
    ).toBeVisible();
    await userEvent.click(
      menu.getByRole("menuitem", { name: words.backToProjects }),
    );
    await expect(args.onHome).toHaveBeenCalled();
  },
};
