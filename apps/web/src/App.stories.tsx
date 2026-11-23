import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "./config.ts";
import {
  AppView,
  BootView,
  NoProjectOpen,
  ProjectLoadFailure,
  WhatsNewDialog,
} from "./App.view.tsx";

const meta = {
  title: "Screens/Shell/App",
  component: AppView,
  parameters: { layout: "fullscreen" },
  args: {
    current: "newProject",
    roomOpen: false,
    sidebar: {
      name: "Acme product team",
      open: true,
      drawer: false,
      needsProvider: false,
      onToggleSidebar: fn(),
      onNewProject: fn(),
      onConnectModel: fn(),
      onAllProjects: fn(),
      onWorkspaceSettings: fn(),
      onAccount: fn(),
    },
    hub: { state: "answering" },
    setupFault: null,
    page: <p>The page on screen.</p>,
    onOpenPreferences: fn(),
  },
} satisfies Meta<typeof AppView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

export const SignedInDark: Story = { globals: { mode: "dark" } };

/** No model is connected yet, so the first steps offer to connect one. */
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

export const Library: Story = { args: { current: "library" } };

export const Settings: Story = { args: { current: "settings" } };

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

/** What's new opens from the first steps. */
export const OpensWhatsNew: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: new RegExp(wording.shell.whatsNew),
      }),
    );
    await expect(
      await within(document.body).findByRole("dialog"),
    ).toBeInTheDocument();
  },
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

export const WhatsNew: Story = {
  render: () => <WhatsNewDialog onClose={fn()} onOpenPreferences={fn()} />,
};

export const WhatsNewApprovals: Story = {
  render: () => (
    <WhatsNewDialog
      initialTab="approvals"
      onClose={fn()}
      onOpenPreferences={fn()}
    />
  ),
};

/** Before the hub has said who is signed in. */
export const Starting: Story = { render: () => <BootView wait="starting" /> };

export const StillStarting: Story = { render: () => <BootView wait="slow" /> };

/** The hub cannot be reached; the app waits here and retries. */
export const WaitingForHub: Story = {
  render: () => <BootView wait="offline" />,
};
