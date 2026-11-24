import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  AppView,
  BootView,
  NoProjectOpen,
  ProjectLoadFailure,
} from "./App.view.tsx";
import projects from "./pages/projects.stories.tsx";
import { ProjectsView } from "./pages/projects.view.tsx";
import { productName } from "./config.ts";
import settings from "./pages/settings/settings.stories.tsx";
import { SettingsView } from "./pages/settings/settings.view.tsx";

const meta = {
  title: "Screens/Shell/App",
  component: AppView,
  parameters: { layout: "fullscreen" },
  args: {
    current: "library",
    roomOpen: false,
    sidebar: {
      name: "Acme product team",
      open: true,
      drawer: false,
      needsProvider: false,
      recent: [
        { id: "bakery", title: "Bakery orders" },
        { id: "walks", title: "Dog walking bookings" },
        { id: "rota", title: "Café staff rota" },
      ],
      onToggleSidebar: fn(),
      onNewProject: fn(),
      onConnectModel: fn(),
      onOpenProject: fn(),
      onWorkspaceSettings: fn(),
      onAccount: fn(),
    },
    hub: { state: "answering" },
    setupFault: null,
    page: <p>The page on screen.</p>,
  },
} satisfies Meta<typeof AppView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

/**
 * The new project page stands alone: no sidebar, the product's mark and name in one top corner,
 * and Workspace settings and Account in the other. Its own recent projects list sits under the
 * prompt.
 */
export const Home: Story = {
  args: {
    current: "newProject",
    page: <ProjectsView {...projects.args} />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(productName)).toBeVisible();
    await expect(
      canvas.queryByRole("complementary", { name: "Workspace" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Workspace settings" }),
    );
    await expect(args.sidebar.onWorkspaceSettings).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Account" }));
    await expect(args.sidebar.onAccount).toHaveBeenCalled();
  },
};

export const HomeDark: Story = {
  args: { current: "newProject" },
  globals: { mode: "dark" },
};

export const SignedInDark: Story = { globals: { mode: "dark" } };

/** No model is connected yet, so the sidebar offers to connect one. */
export const NeedsModel: Story = {
  args: { sidebar: { ...meta.args.sidebar, needsProvider: true } },
};

/**
 * A project's room on the page draws its own sidebar, so the workspace's steps aside and the
 * canvas is only the ground the room stands on.
 */
export const RoomOpen: Story = {
  args: { current: "project", roomOpen: true },
};

/**
 * Settings stands alone, as the new project page does: no sidebar, only the arrow beside its
 * title.
 */
export const Settings: Story = {
  args: {
    current: "settings",
    page: <SettingsView {...settings.args} />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("complementary", { name: "Workspace" }),
    ).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Back to Bakery orders" }),
    ).toBeVisible();
  },
};

export const SettingsDark: Story = {
  ...Settings,
  globals: { mode: "dark" },
};

/** Put away, the sidebar leaves only its name, and the page starts below it. */
export const SidebarClosed: Story = {
  args: { sidebar: { ...meta.args.sidebar, open: false } },
};

/** A narrow window: the sidebar waits as a drawer behind its name. */
export const Narrow: Story = {
  args: { sidebar: { ...meta.args.sidebar, open: false, drawer: true } },
  globals: { viewport: { value: "mobile1" } },
};

/** Opened in a narrow window, the sidebar lies over the page. */
export const NarrowDrawer: Story = {
  args: { sidebar: { ...meta.args.sidebar, open: true, drawer: true } },
  globals: { viewport: { value: "mobile1" } },
};

/** A recent project opens from the sidebar. */
export const OpensRecentProject: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Café staff rota" }),
    );
    await expect(args.sidebar.onOpenProject).toHaveBeenCalledWith("rota");
  },
};

/** A new workspace has no projects yet, so there is nothing to list. */
export const NoRecentProjects: Story = {
  args: { sidebar: { ...meta.args.sidebar, recent: [] } },
};

/** The hub stopped answering. */
export const HubNotAnswering: Story = {
  args: { hub: { state: "notAnswering" } },
};

export const SetupFailed: Story = {
  args: { setupFault: "The hub did not answer in time. Try again." },
};

/** A project was asked for and none is open. */
export const NoProjectToShow: Story = {
  args: { current: "project", page: <NoProjectOpen /> },
};

export const ProjectLoadFailed: Story = {
  args: {
    current: "project",
    page: (
      <ProjectLoadFailure
        detail="The project is not in this workspace's list, or reading it failed."
        onRetry={fn()}
        onBackToProjects={fn()}
      />
    ),
  },
};

/** Before the hub has said who is signed in. */
export const Starting: Story = { render: () => <BootView wait="starting" /> };

export const StillStarting: Story = { render: () => <BootView wait="slow" /> };

/** The hub cannot be reached; the app waits here and retries. */
export const WaitingForHub: Story = {
  render: () => <BootView wait="offline" />,
};
