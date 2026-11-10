import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  AppView,
  BootView,
  NoProjectOpen,
  ProjectLoadFailure,
  WhatsNewDialog,
  type RailProject,
} from "./App.view.tsx";
import {
  ProjectMenuView,
  type ProjectMenuViewProps,
} from "./pages/project-menu.view.tsx";
import { WorkspaceMenuView } from "./workspace-menu.view.tsx";

const project = (id: string, title: string, open = false): RailProject => ({
  id,
  title,
  open,
});

const projects = [
  project("bakery", "Bakery orders"),
  project("clinic", "Clinical trial intake"),
  project("dispatch", "Field service dispatch"),
  project("habits", "Habit tracker"),
];

const menu: Omit<ProjectMenuViewProps, "trigger"> = {
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
};

const meta = {
  title: "Screens/Shell/App",
  component: AppView,
  parameters: { layout: "fullscreen" },
  args: {
    current: "newProject",
    rail: {
      collapsed: false,
      onToggleCollapsed: fn(),
      onNewProject: fn(),
      onLibrary: fn(),
      onBack: fn(),
      onSettings: fn(),
      projects,
      onOpenProject: fn(),
    },
    workspaceMenu: (
      <WorkspaceMenuView
        name="Acme product team"
        workspaces={[
          { id: "acme", name: "Acme product team", open: true },
          { id: "side", name: "Side projects", open: false },
        ]}
        onOpen={fn()}
        onCreate={fn()}
      />
    ),
    projectMenu: (_projectId, trigger) => (
      <ProjectMenuView {...menu} trigger={trigger} />
    ),
    hub: { state: "answering" },
    setupFault: null,
    page: <p>The page on screen.</p>,
    onOpenPreferences: fn(),
  },
} satisfies Meta<typeof AppView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

/** An empty workspace, and any workspace whose list is unread or could not be read: the rail draws them the same. */
export const NoProjects: Story = {
  args: { rail: { ...meta.args.rail, projects: [] } },
};

export const ProjectOpen: Story = {
  args: {
    current: "project",
    rail: {
      ...meta.args.rail,
      projects: [
        project("bakery", "Bakery orders", true),
        ...projects.slice(1),
      ],
    },
  },
};

export const Library: Story = { args: { current: "library" } };

/** Settings adds a way back to where it was opened from. */
export const Settings: Story = { args: { current: "settings" } };

export const RailCollapsed: Story = {
  args: { rail: { ...meta.args.rail, collapsed: true } },
};

/** A phone-width window starts with the icon rail, so the page keeps the screen. */
export const Narrow: Story = {
  ...RailCollapsed,
  globals: { viewport: "mobile1" },
};

/** Opened at phone width, the full rail lies over the page. */
export const NarrowRailOpen: Story = {
  globals: { viewport: "mobile1" },
};

/** The hub stopped answering; the rail keeps the list it last read. */
export const HubNotAnswering: Story = {
  args: { hub: { state: "notAnswering" } },
};

export const HubSlow: Story = {
  args: { hub: { state: "slow", averageMs: 2400 } },
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
