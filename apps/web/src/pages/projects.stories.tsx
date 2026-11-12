import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { ProjectsView, type ProjectsViewProps } from "./projects.view.tsx";

// Holds what the page asks its host to keep: the idea being typed and the profile picked.
function Page(args: ProjectsViewProps) {
  const [idea, setIdea] = useState(args.idea);
  const [profile, setProfile] = useState(args.profile);
  return (
    <ProjectsView
      {...args}
      idea={idea}
      onIdeaChange={setIdea}
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
    idea: "",
    onIdeaChange: fn(),
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

export const WithIdea: Story = { args: { idea: IDEA } };

/** The hub is creating the project; the prompt and both imports wait. */
export const Starting: Story = { args: { idea: IDEA, activity: "starting" } };

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
