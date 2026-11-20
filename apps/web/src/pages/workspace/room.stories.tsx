import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import { AppView } from "../../App.view.tsx";
import app from "../../App.stories.tsx";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import type { PlanView } from "@corbits-builder/schemas/project";
import type { ArtifactPaneProps } from "./artifact-pane.tsx";
import documentPane, {
  AppAndManual as appAndManual,
  Concepts as conceptTabs,
  DesignDraft as designDraft,
  Loading as loadingDocument,
  ReadError as failedDocument,
} from "./artifact-pane.stories.tsx";
import { planning } from "./project-outline.fixtures.ts";
import { projectOutline, type OutlineAppState } from "./project-outline.ts";
import { question } from "./prompt-box.fixtures.ts";
import { LIVE_TAB } from "./tab-follow.ts";
import {
  RoomView,
  type RoomComposer,
  type RoomContent,
  type RoomViewProps,
} from "./room.view.tsx";
import thread, {
  Thinking as coordinatorThinking,
} from "./transcript.stories.tsx";

// Holds what the room asks its host to keep: the words being typed, whether the project view is
// open, the document it reads, the tab it shows and whether the sidebar is out.
function Room(args: RoomViewProps) {
  const { dock, documentPane: pane, sidebar } = args;
  const [text, setText] = useState(dock.kind === "composer" ? dock.text : "");
  const [projectOpen, setProjectOpen] = useState(args.layout.projectOpen);
  const [selectedId, setSelectedId] = useState(pane.selectedId);
  const [openTab, setOpenTab] = useState(pane.openTab ?? null);
  const [shown, setShown] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(sidebar.open);
  const open = (tab: string) => {
    setOpenTab({ value: tab });
    setProjectOpen(true);
  };
  const onScreen = projectOpen ? shown : null;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <RoomView
        {...args}
        layout={{
          ...args.layout,
          projectOpen,
          onProjectOpenChange: setProjectOpen,
        }}
        dock={
          dock.kind === "composer"
            ? { ...dock, text, onTextChange: setText }
            : dock
        }
        sidebar={{
          ...sidebar,
          open: sidebarOpen,
          selectedFile: onScreen === LIVE_TAB ? null : onScreen,
          appOpen: onScreen === LIVE_TAB,
          onToggleSidebar: () => setSidebarOpen(!sidebarOpen),
          onOpenFile: (id) => {
            // A design not filed yet opens what is being drawn under it.
            const drawing = sidebar.files.find(
              (file) => file.id === id && file.state === "drawing",
            );
            open(drawing?.parts[0]?.id ?? id);
            sidebar.onOpenFile(id);
          },
          onOpenApp: () => {
            open(LIVE_TAB);
            sidebar.onOpenApp();
          },
        }}
        documentPane={{
          ...pane,
          openTab,
          onShownChange: setShown,
          selectedId,
          state: selectedId === null ? undefined : pane.state,
          onSelect: setSelectedId,
        }}
      />
    </div>
  );
}

// The sidebar as the room's model would hand it over for what the project view shows.
function sidebarOf(
  pane: Partial<ArtifactPaneProps>,
  plan: PlanView["steps"] = planning.plan,
  app?: OutlineAppState,
): RoomContent["sidebar"] {
  const outline = projectOutline({
    plan,
    documents: (pane.documents ?? []).map((item) => ({
      ...item,
      written: isDocumentKind(item.id),
    })),
    draft: (pane.draft ?? null) !== null,
    concepts: (pane.concepts ?? []).map((concept) => ({
      label: concept.label,
      drawn: concept.content !== undefined,
    })),
    manual: (pane.manual ?? null) !== null,
    app: { shown: (pane.liveApp ?? null) !== null, state: app },
  });
  return {
    project: "Bakery orders",
    open: true,
    plan: outline.plan,
    files: outline.files,
    selectedFile: null,
    app: outline.app,
    appOpen: false,
    onToggleSidebar: fn(),
    onOpenFile: fn(),
    onPrintFile: fn(),
    onRemoveFile: fn(),
    onAskFirst: fn(),
    onDecline: fn(),
    onOpenApp: fn(),
    onProjectSettings: fn(),
    onSecrets: fn(),
    onAllProjects: fn(),
    onNewProject: fn(),
    onWorkspaceSettings: fn(),
    onAccount: fn(),
  };
}

const composer: RoomComposer & { kind: "composer" } = {
  kind: "composer",
  text: "",
  onTextChange: fn(),
  onSend: fn(),
  placeholder: wording.composer.reply,
  inputRef: createRef(),
  working: false,
  busy: false,
  disabled: false,
  needsProvider: false,
  onEnableAi: fn(),
  attachments: {
    files: [],
    accept: "text/plain,image/png",
    fault: null,
    onAdd: fn(),
    onRemove: fn(),
  },
  sendFault: null,
  restarts: null,
  suggestedReplies: [],
  onReply: fn(),
  sendLabel: null,
  status: null,
  onStop: fn(),
};

// One of the pane's own stories as the room takes it: what the pane shows, its parts, and the
// sidebar that lists them.
function paneOf(story: Partial<ArtifactPaneProps> = {}) {
  const pane = { ...documentPane.args, ...story };
  return { documentPane: pane, paneParts: pane, sidebar: sidebarOf(pane) };
}

const layout: RoomViewProps["layout"] = {
  projectReady: false,
  projectOpen: false,
  onProjectOpenChange: fn(),
};

// The room once the first documents are filed: the conversation still fills the room, and the
// project control opens them over it.
const withDocuments = {
  layout: { ...layout, projectReady: true },
  ...paneOf(),
} satisfies Partial<RoomViewProps>;

const meta = {
  title: "Screens/Workspace/Room",
  component: RoomView,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Bakery orders",
    layout,
    conversation: {
      thread: thread.args,
      empty: null,
    },
    dock: composer,
    ...paneOf(),
    tabStatus: [],
    sidebar: sidebarOf({}, []),
    paneRef: createRef(),
    waiting: null,
    space: null,
    pluginSpace: null,
  },
  render: (args) => <Room {...args} />,
} satisfies Meta<typeof RoomView>;

export default meta;
type Story = StoryObj<typeof meta>;

const conversation = meta.args.conversation;

/** A project just started: nothing said and nothing filed, so the conversation is the whole room. */
export const NewProject: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
      empty: "new",
    },
  },
};

/** Talking with the coordinator before anything is filed. */
export const Conversation: Story = {};

export const CoordinatorThinking: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, ...coordinatorThinking.args },
    },
    // The coordinator's own turn cannot be stopped, so Send stays while the pill says it thinks.
    dock: {
      ...composer,
      status: { state: "working", label: wording.promptBox.status.thinking },
    },
  },
};

/** A tool asks before it runs: the ask waits in the prompt box, Yes where Send stands. */
export const ApprovalWaiting: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...composer,
      placeholder: wording.approval.composerPlaceholder,
    },
    waiting: {
      kind: "approval",
      approval: {
        approvalId: "approval-1",
        toolName: "run_shell",
        subject: "bun run build",
      },
      disabled: false,
      error: null,
      typedYes: null,
      onDecide: fn(),
    },
  },
};

/** The coordinator's question waits in the prompt box; the person's own words answer it too. */
export const QuestionsOpen: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: wording.questions.composerPlaceholder,
    },
    waiting: {
      kind: "question",
      question,
      disabled: false,
      onAnswer: fn(() => Promise.resolve(true)),
    },
  },
};

/** The coordinator's last message offered answers; each is sent as it is. */
export const SuggestedReplies: Story = {
  args: {
    dock: {
      ...composer,
      suggestedReplies: ["The owner", "Counter staff"],
    },
  },
};

/** A file waits in the composer, and another was too big to take. */
export const AttachmentAndFault: Story = {
  args: {
    dock: {
      ...composer,
      text: "Here is last Saturday's order sheet.",
      attachments: {
        ...composer.attachments,
        files: [
          {
            id: "orders",
            name: "saturday-orders.csv",
            mediaType: "text/plain",
            size: 18_400,
          },
        ],
        fault: wording.attach.tooLarge("oven-manual.pdf", 10_000_000),
      },
    },
  },
};

export const SendFailed: Story = {
  args: {
    dock: {
      ...composer,
      text: "Can you start on the plan?",
      sendFault: "That message was not sent.",
    },
  },
};

/** The message changes a document work already builds from: one line says what sending restarts. */
export const EarlierDocumentCaution: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...composer,
      text: "Change the problem brief: we also take orders by email.",
      restarts: wording.earlierDocument.restarts(
        wording.earlierDocument.work["design"] ?? "",
      ),
    },
  },
};

/** No model provider is connected, so the box offers Enable AI in place of sending. */
export const NoProvider: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
      empty: "new",
    },
    dock: { ...composer, needsProvider: true },
  },
};

/** The project has no model to run on, which only Settings can settle. */
export const ModelNeeded: Story = {
  args: {
    dock: {
      kind: "modelNeeded",
      message: "Choose a model profile for this project.",
      onOpenSettings: fn(),
      onRetry: fn(),
    },
  },
};

/** The coordinator is starting; the person does not start it by typing. */
export const Starting: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
    },
    dock: { kind: "starting" },
  },
};

export const StartFailed: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
    },
    dock: {
      kind: "startFailed",
      message: wording.message.coordinatorNotStarted,
      onRetry: fn(),
    },
  },
};

/** An archived project is read-only until it is restored. */
export const Archived: Story = {
  args: {
    ...withDocuments,
    ...paneOf(),
    dock: {
      kind: "archived",
      restoring: false,
      fault: null,
      onRestore: fn(),
    },
  },
};

export const ArchivedHubNotAnswering: Story = {
  ...Archived,
  render: (args) => (
    <AppView
      {...app.args}
      current="project"
      hub={{ state: "notAnswering" }}
      setupFault="Failed to fetch"
      page={<RoomView {...args} />}
    />
  ),
};

export const ArchivedRestoring: Story = {
  args: {
    ...withDocuments,
    ...paneOf(),
    dock: {
      kind: "archived",
      restoring: true,
      fault: null,
      onRestore: fn(),
    },
  },
};

/** Documents are filed; the conversation fills the room and the project control opens them. */
export const WithDocument: Story = { args: withDocuments };

/** The project view open over the room, the prompt box still at its foot. */
export const ProjectOpen: Story = {
  args: {
    ...withDocuments,
    layout: { ...withDocuments.layout, projectOpen: true },
  },
};

export const DocumentLoading: Story = {
  args: {
    ...withDocuments,
    ...paneOf(loadingDocument.args),
  },
};

export const DocumentFailed: Story = {
  args: {
    ...withDocuments,
    ...paneOf(failedDocument.args),
  },
};

/** The app is being built: it runs in the open project view, beside the plan it is built from and its manual. */
export const AppBuilt: Story = {
  args: {
    ...ProjectOpen.args,
    ...paneOf({ ...appAndManual.args, openTab: { value: LIVE_TAB } }),
  },
};

/** The designers' concepts are filed, each a row under the design. */
export const ChoosingADesign: Story = {
  args: {
    ...withDocuments,
    ...paneOf(conceptTabs.args),
  },
};

/** A plugin's tab says where its work stands in the room's top bar, and opens from there. */
export const TabStatus: Story = {
  args: {
    ...withDocuments,
    tabStatus: [
      { tab: "Publish", label: "Published", mark: "done", onOpen: fn() },
    ],
  },
};

/** The design's mockup is being drawn: its row and the mockup under it carry the writing dots. */
export const DrawingTheDesign: Story = {
  args: {
    ...withDocuments,
    ...paneOf(designDraft.args),
  },
};

// The brief's row, as the sidebar names it.
const briefName = wording.documentTab["problem_brief"] ?? "";

const appArgs = paneOf(appAndManual.args);
const appSidebar = (state: OutlineAppState) =>
  sidebarOf(appArgs.documentPane, planning.plan, state);

/** The app runs as the hub keeps it while the project is open; Live opens it. */
export const AppRunning: Story = {
  args: {
    ...withDocuments,
    ...appArgs,
    sidebar: appSidebar("running"),
  },
};

export const AppStopped: Story = {
  args: {
    ...withDocuments,
    ...appArgs,
    sidebar: appSidebar("stopped"),
  },
};

export const AppFailed: Story = {
  args: {
    ...withDocuments,
    ...appArgs,
    sidebar: appSidebar("failed"),
  },
};

/** The sidebar put away: its toggle keeps the room's corner, with the project's name. */
export const SidebarClosed: Story = {
  args: {
    ...withDocuments,
    sidebar: { ...withDocuments.sidebar, open: false },
  },
};

/** Put away beside the open project view, whose header leaves the corner to the toggle. */
export const SidebarClosedProjectOpen: Story = {
  args: {
    ...ProjectOpen.args,
    sidebar: { ...withDocuments.sidebar, open: false },
  },
};

/**
 * A file row opens the project view over the conversation, and what the person had half typed
 * stays in the box.
 */
export const OpenFileKeepsMessage: Story = {
  args: {
    ...withDocuments,
    dock: { ...composer, text: "Also take orders by" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const brief = canvas.getByRole("treeitem", { name: briefName });
    // The row is clicked where a pointer clicks it, on its name.
    await userEvent.click(within(brief).getByText(briefName));
    await expect(brief).toHaveAttribute("aria-current", "page");
    await expect(
      canvasElement.querySelector('[data-slot="room-project"]'),
    ).not.toHaveAttribute("hidden");
    // The box moves into the project view, with what was typed.
    await expect(canvas.getByRole("textbox")).toHaveValue(
      "Also take orders by",
    );
  },
};

export const ProjectOpenDark: Story = {
  ...ProjectOpen,
  globals: { mode: "dark" },
};

/** Too narrow for the sidebar beside the page, it waits as a drawer behind its toggle. */
export const Narrow: Story = {
  args: withDocuments,
  globals: { viewport: { value: "mobile1" } },
};

/** The drawer out over the room. */
export const NarrowDrawer: Story = {
  ...Narrow,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Bakery orders/, expanded: false }),
    );
    await expect(
      canvasElement.querySelector('[data-slot="project-sidebar"]'),
    ).toHaveAttribute("data-open");
  },
};

export const NarrowDrawerDark: Story = {
  ...NarrowDrawer,
  globals: { ...Narrow.globals, mode: "dark" },
};

/** Choosing a file in the drawer puts the drawer away and opens the file. */
export const NarrowDrawerOpensFile: Story = {
  ...Narrow,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Bakery orders/, expanded: false }),
    );
    const brief = canvas.getByRole("treeitem", {
      name: briefName,
    });
    // The row is clicked where a pointer clicks it, on its name.
    await userEvent.click(within(brief).getByText(briefName));
    await expect(
      canvas.getByRole("button", { name: /Bakery orders/, expanded: false }),
    ).toBeInTheDocument();
    await expect(brief).toHaveAttribute("aria-current", "page");
  },
};
