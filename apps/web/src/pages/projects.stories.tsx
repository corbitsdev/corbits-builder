import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../config.ts";
import { ProjectsView, type ProjectsViewProps } from "./projects.view.tsx";

// Holds what the page asks its host to keep: the idea being typed, what is typed while it starts
// and the profile picked.
function Page(args: ProjectsViewProps) {
  const [idea, setIdea] = useState(args.idea);
  const [followUp, setFollowUp] = useState(args.followUp);
  const [profile, setProfile] = useState(args.profile);
  return (
    <ProjectsView
      {...args}
      idea={idea}
      onIdeaChange={setIdea}
      followUp={followUp}
      onFollowUpChange={setFollowUp}
      profile={profile}
      onProfileChange={setProfile}
    />
  );
}

const meta = {
  title: "Screens/NewProject",
  component: ProjectsView,
  parameters: { layout: "fullscreen" },
  args: {
    activity: "idle",
    sidebar: {
      open: true,
      drawer: false,
      onToggleSidebar: fn(),
      onHome: fn(),
      onPreferences: fn(),
    },
    idea: "",
    onIdeaChange: fn(),
    followUp: "",
    onFollowUpChange: fn(),
    onStart: fn(),
    profiles: [
      {
        id: "balanced",
        name: "Balanced",
        detail: "Good for most projects",
        group: "Anthropic",
      },
      {
        id: "thorough",
        name: "Thorough",
        detail: "Slower, for harder work",
        group: "Anthropic",
      },
      { id: "mine", name: "Weekend build", detail: "Yours", group: "OpenAI" },
    ],
    profile: "balanced",
    onProfileChange: fn(),
    needsProvider: false,
    recent: [
      {
        id: "calculator",
        title:
          "Can you build me a calculator and a way to track daily spending",
        stage: "building",
        lastActivityAt: "2026-05-02T10:00:00Z",
        lastActive: "2 hours ago",
        mockup: null,
      },
      {
        id: "calories",
        title: "Create a calorie tracking app",
        stage: "shipped",
        lastActivityAt: "2026-05-01T12:00:00Z",
        lastActive: "yesterday",
        mockup: null,
      },
      {
        id: "landing",
        title: "I wanna build a personal landing page",
        stage: "idea",
        lastActivityAt: "2026-04-29T09:00:00Z",
        lastActive: "3 days ago",
        mockup: null,
      },
      {
        id: "bakery",
        title: "Order list for a small bakery",
        stage: "building",
        lastActivityAt: "2026-04-25T09:00:00Z",
        lastActive: "last week",
        mockup: null,
      },
    ],
    onCoverNear: fn(),
    onOpenLibrary: fn(),
    onOpenProject: fn(),
    onConnectProvider: fn(),
    onImportFile: fn(),
    onPickFolder: fn(),
    onImportFolderFiles: fn(),
    approvals: null,
    folder: null,
  },
  render: (args) => <Page {...args} />,
} satisfies Meta<typeof ProjectsView>;

export default meta;
type Story = StoryObj<typeof meta>;

const IDEA =
  "An order list for a small bakery, so phone orders stop getting lost on busy Saturdays.";

export const Empty: Story = {};

/** A recent project under the prompt opens it. */
export const OpensRecentProject: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: /Create a calorie tracking app/,
      }),
    );
    await expect(args.onOpenProject).toHaveBeenCalledWith("calories");
  },
};

/** All projects beside Recent projects opens the Projects page. */
export const OpensAllProjects: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "All projects" }),
    );
    await expect(args.onOpenLibrary).toHaveBeenCalled();
  },
};

/** When the recent cards are every project there is, nothing offers All projects. */
export const RecentIsEverything: Story = {
  render: (args) => <Page {...args} onOpenLibrary={undefined} />,
};

/** A new workspace has no projects yet, so the prompt stands alone. */
export const NoRecentProjects: Story = {
  args: { recent: [] },
  render: (args) => <Page {...args} onOpenLibrary={undefined} />,
};

/** With every project archived nothing is recent, and All projects still leads to them. */
export const EveryProjectArchived: Story = {
  args: { recent: [] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.shell.allProjects,
      }),
    );
    await expect(args.onOpenLibrary).toHaveBeenCalled();
  },
};

export const WithIdea: Story = { args: { idea: IDEA } };

/**
 * Sent, the page becomes the room the project opens into: the sidebar beside it, the person's
 * words at the top with the coordinator thinking under them, and the box at the foot saying the
 * project is starting. The sidebar is the room's own, its plan empty and its links working, all
 * but the project's settings, which wait for the project.
 */
// The room fills the window's height, as the app's canvas gives it.
const fullHeight: NonNullable<Story["decorators"]> = [
  (Story) => (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Story />
    </div>
  ),
];

export const Starting: Story = {
  args: { idea: IDEA, activity: "starting" },
  decorators: fullHeight,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // The person's words are their message, and the project's name until it has one.
    await expect(canvas.getAllByText(IDEA)).toHaveLength(2);
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
    await expect(
      canvas.getByText(wording.newProject.starting, { selector: "p" }),
    ).toHaveAttribute("role", "status");
    // The cursor is already in the room's box, which takes more words while sending waits.
    const box = canvas.getByRole("textbox");
    await expect(box).toHaveFocus();
    await userEvent.keyboard("Keep it short");
    await expect(box).toHaveValue("Keep it short");
    await userEvent.keyboard("{Enter}");
    await expect(box).toHaveValue("Keep it short");
    await userEvent.click(
      canvas.getByRole("button", { name: wording.projectShell.menu }),
    );
    await userEvent.click(
      within(document.body).getByRole("menuitem", {
        name: wording.projectShell.backToProjects,
      }),
    );
    await expect(args.sidebar.onHome).toHaveBeenCalled();
  },
};

export const StartingDark: Story = {
  args: { idea: IDEA, activity: "starting" },
  decorators: fullHeight,
  globals: { mode: "dark" },
};

/** Nothing can start until a model provider is connected. */
export const NeedsProvider: Story = {
  args: { needsProvider: true, profiles: [], profile: undefined },
};

/** A project file that marks documents approved asks before it records them. */
export const ImportMarksApprovals: Story = {
  args: {
    approvals: {
      fileName: "bakery-orders.zip",
      documents: ["Problem brief", "Product requirements"],
      onImport: fn(),
      onCancel: fn(),
    },
  },
};

const reading = {
  title: "Bakery orders",
  folderName: "bakery-orders",
  code: { files: 148, size: "1.2 MB" },
  found: ["Problem brief", "Design"],
  toWrite: ["Product requirements", "Technical plan"],
  empty: false,
  warnings: ["The package manager is pnpm; the coder installs with bun."],
  leaveOut: [
    { path: ".env.local", reason: "looks like a secret", leftOut: true },
    {
      path: "pnpm-lock.yaml",
      reason: "a lockfile Builder does not use",
      leftOut: true,
    },
  ],
};
const folder = {
  reading,
  onLeaveOut: fn(),
  onImport: fn(),
  onCancel: fn(),
};

export const FolderRead: Story = { args: { folder } };

/** Ticking a file re-reads the folder, and the notice holds meanwhile. */
export const FolderReading: Story = {
  args: { folder, activity: "importing" },
};

export const FolderWithDocumentsOnly: Story = {
  args: {
    folder: {
      ...folder,
      reading: {
        ...reading,
        code: null,
        toWrite: [],
        warnings: [],
        leaveOut: [],
      },
    },
  },
};

export const FolderWithNothing: Story = {
  args: {
    folder: {
      ...folder,
      reading: {
        ...reading,
        code: null,
        found: [],
        toWrite: [],
        empty: true,
        warnings: [],
        leaveOut: [],
      },
    },
  },
};
