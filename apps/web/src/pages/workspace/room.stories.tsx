import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useState, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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
import designer from "@plugins/designer/package.json";
import pickColours from "@plugins/designer/src/pick-colours/definition.ts";
import PickColoursView from "@plugins/designer/src/pick-colours/view.tsx";
import { question } from "./prompt-box.fixtures.ts";
import { ScreenStory, storyScreen } from "./screen-story.tsx";
import { LIVE_TAB } from "./tab-follow.ts";
import { RoomThread } from "./transcript.tsx";
import writtenDocument, {
  Comparing as comparingVersions,
  OlderVersion as olderVersion,
} from "./written-document.stories.tsx";
import {
  WrittenDocumentView,
  type WrittenDocumentViewProps,
} from "./written-document.view.tsx";
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
  // What the project view shows, by name, as the room's model names it.
  const shownName =
    onScreen === LIVE_TAB
      ? wording.projectShell.appTab
      : (outlineOf(pane)
          .files.flatMap((file) => [file, ...file.parts])
          .find((row) => row.id === onScreen)?.name ?? null);
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
        shownName={shownName}
        sidebar={{
          ...sidebar,
          open: sidebarOpen,
          appOpen: onScreen === LIVE_TAB,
          onToggleSidebar: () => setSidebarOpen(!sidebarOpen),
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

// The project's outline as the room's model reads it from what the project view shows.
function outlineOf(
  pane: Partial<ArtifactPaneProps>,
  plan: PlanView["steps"] = planning.plan,
  app?: OutlineAppState,
) {
  return projectOutline({
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
}

// The sidebar as the room's model would hand it over for what the project view shows.
function sidebarOf(
  pane: Partial<ArtifactPaneProps>,
  plan: PlanView["steps"] = planning.plan,
  app?: OutlineAppState,
): RoomContent["sidebar"] {
  const outline = outlineOf(pane, plan, app);
  return {
    project: "Bakery orders",
    open: true,
    plan: outline.plan,
    app: outline.app,
    appOpen: false,
    onToggleSidebar: fn(),
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
    shownName: null,
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

/** A specialist is at work: the pill says what it does, and Stop, red, stands where Send was. */
export const SpecialistWorking: Story = {
  args: {
    dock: {
      ...composer,
      working: true,
      status: { state: "working", label: "Writing the Problem brief" },
    },
  },
};

/** A newer version is filed: the pill says so, and its button opens it. */
export const NewVersionReady: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...composer,
      status: {
        state: "ready",
        label: wording.promptBox.status.ready("Problem brief", 2),
        action: wording.promptBox.status.open,
        onAction: fn(),
      },
    },
  },
};

/** Work failed since the person last wrote: the pill says what, and offers to ask again. */
export const WorkFailed: Story = {
  args: {
    dock: {
      ...composer,
      status: {
        state: "failed",
        label: wording.promptBox.status.didNotFinish(
          "Writing the Problem brief",
        ),
        action: wording.promptBox.status.tryAgain,
        onAction: fn(),
      },
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

/** A step the person asked to be consulted on waits for their go-ahead in the prompt box. */
export const StepGoAhead: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: wording.promptBox.waiting.stepPlaceholder,
    },
    waiting: {
      kind: "step",
      title: "Build the app",
      busy: false,
      onGoAhead: fn(),
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
 * Open project brings the project view over the conversation, and what the person had half typed
 * stays in the box.
 */
export const OpenProjectKeepsMessage: Story = {
  args: {
    ...withDocuments,
    dock: { ...composer, text: "Also take orders by" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: wording.conversation.openProject }),
    );
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

// The project view open on the brief, with the conversation behind the prompt box to pull up.
const chatBehindBox = {
  ...ProjectOpen.args,
  chat: <RoomThread {...thread.args} />,
} satisfies Partial<RoomViewProps>;

/** The chat over the project view, which is shown only while pulled up. */
const chatHistory = (canvasElement: HTMLElement) =>
  canvasElement.querySelector(
    '[data-slot="room-project"] [data-slot="chat-history"]',
  );

/** Pulls the chat up from the handle, as the keyboard does it, so it opens at once. */
async function openChat(canvasElement: HTMLElement) {
  const handle = canvasElement.querySelector<HTMLElement>(
    '[data-slot="room-project"] [data-slot="pull-handle"]',
  );
  if (handle === null) throw new Error("No handle on the box");
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await waitFor(() =>
    expect(chatHistory(canvasElement)).not.toHaveAttribute("hidden"),
  );
}

/** Over the project view the box has a handle on its top edge; the chat waits behind it. */
export const ChatSheetClosed: Story = { args: chatBehindBox };

/** The chat pulled up over the page, the box where it was; the page still shows above it. */
export const ChatSheetOpen: Story = {
  args: chatBehindBox,
  play: async ({ canvasElement }) => openChat(canvasElement),
};

/**
 * Pulled up over a design, the chat lies over it as it does over a written page: the design keeps
 * its size beneath it, and the design's floating bar steps aside rather than stand over the design
 * on the sheet's top edge.
 */
export const ChatSheetOverDesign: Story = {
  args: {
    ...ChoosingADesign.args,
    layout: { ...withDocuments.layout, projectOpen: true },
    chat: <RoomThread {...thread.args} />,
  },
  play: async ({ canvasElement }) => {
    const project = canvasElement.querySelector<HTMLElement>(
      '[data-slot="room-project"]',
    );
    const pane = project?.querySelector<HTMLElement>(
      '[data-slot="artifact-pane"]',
    );
    if (!project || !pane) throw new Error("No project view");
    // The design's own bar, once its pane has opened and faded in.
    const bar = () =>
      project.querySelector(
        '[data-slot="panel-pane"][data-state="active"] [data-slot="pane-bar"][data-floating]',
      );
    await waitFor(() => expect(bar()).toBeVisible());
    await openChat(canvasElement);
    await expect(pane.getBoundingClientRect().height).toBe(
      project.getBoundingClientRect().height,
    );
    await expect(bar()).not.toBeVisible();
  },
};

/** Full screen, the chat hides the page and names it for the way back. */
export const ChatSheetFullScreen: Story = {
  args: chatBehindBox,
  play: async ({ canvasElement }) => {
    await openChat(canvasElement);
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.chat.fullScreen,
      }),
    );
    await expect(
      await within(canvasElement).findByRole("button", {
        name: wording.promptBox.chat.backTo(briefName),
      }),
    ).toBeInTheDocument();
  },
};

/**
 * The box is the same box with the chat up or put back: what was typed stays, and Escape puts the
 * chat back with the cursor in the words.
 */
export const ChatSheetKeepsMessage: Story = {
  args: chatBehindBox,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole("textbox");
    await userEvent.type(box, "Also take orders by");
    await openChat(canvasElement);
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(chatHistory(canvasElement)).toHaveAttribute("hidden"),
    );
    await expect(box).toHaveFocus();
    await expect(box).toHaveValue("Also take orders by");
    // The project view stays open: the first Escape was the chat's.
    await expect(
      canvasElement.querySelector('[data-slot="room-project"]'),
    ).not.toHaveAttribute("hidden");
  },
};

/** At phone width the sheet keeps its inset around the box over the page. */
export const ChatSheetNarrow: Story = {
  ...ChatSheetOpen,
  globals: { viewport: { value: "mobile1" } },
};

export const ChatSheetClosedDark: Story = {
  ...ChatSheetClosed,
  globals: { mode: "dark" },
};

export const ChatSheetOpenDark: Story = {
  ...ChatSheetOpen,
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

/** Opening the app from the drawer puts the drawer away and shows the app. */
export const NarrowDrawerOpensApp: Story = {
  args: { ...withDocuments, ...appArgs, sidebar: appSidebar("running") },
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Bakery orders/, expanded: false }),
    );
    await userEvent.click(
      canvas.getByRole("button", {
        name: wording.projectShell.appState.running,
      }),
    );
    await expect(
      canvas.getByRole("button", { name: /Bakery orders/, expanded: false }),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-slot="room-project"]'),
    ).not.toHaveAttribute("hidden");
  },
};

const pickColoursScreen = storyScreen(
  "@corbits-builder/designer pick-colours",
  designer.builder.actions["pick-colours"],
  { screen: pickColours, view: PickColoursView, data: undefined },
);

/**
 * A plugin's screen waits: on a wide window the plugin space stands beside the conversation without
 * taking focus, the box names the screen with Open, and the screen's forward action stands where
 * Send is.
 */
export const ScreenWaiting: Story = {
  args: {
    waiting: { kind: "screen", title: "Pick colours" },
    space: { key: "screen:story", title: "Pick colours" },
    pluginSpace: (
      <ScreenStory
        screen={pickColoursScreen}
        state="open"
        input={{ proposed: { primary: "#1d4ed8" } }}
        project={{
          "look.color-primary": "#c2410c",
          "look.color-background": "#ffffff",
        }}
      />
    ),
  },
};

/** The plugin space beside the open project view, as beside the conversation. */
export const ScreenWaitingProjectOpen: Story = {
  args: {
    ...ScreenWaiting.args,
    ...withDocuments,
    layout: { ...withDocuments.layout, projectOpen: true },
  },
};

// A room narrower than the plugin space's column needs, as on a phone or a split window.
const narrow = {
  decorators: [
    (Story: () => ReactNode) => (
      <div style={{ width: 420, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};

/** On a narrow room the space waits closed: the box names the screen, and Open brings it up. */
export const ScreenWaitingNarrow: Story = { ...ScreenWaiting, ...narrow };

/** Open lays the screen over the main area as a sheet, the prompt box beneath and Close above. */
export const ScreenSheetNarrow: Story = {
  ...ScreenWaitingNarrow,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: wording.promptBox.waiting.openScreen,
      }),
    );
    await expect(
      await canvas.findByRole("heading", { name: "Pick colours" }),
    ).toHaveFocus();
  },
};

export const QuestionsOpenNarrow: Story = { ...QuestionsOpen, ...narrow };

export const DarkQuestionsOpen: Story = {
  ...QuestionsOpen,
  globals: { mode: "dark" },
};

export const DarkApprovalWaiting: Story = {
  ...ApprovalWaiting,
  globals: { mode: "dark" },
};

export const DarkStepGoAhead: Story = {
  ...StepGoAhead,
  globals: { mode: "dark" },
};

export const DarkSpecialistWorking: Story = {
  ...SpecialistWorking,
  globals: { mode: "dark" },
};

export const DarkScreenWaiting: Story = {
  ...ScreenWaiting,
  globals: { mode: "dark" },
};

export const DarkScreenSheetNarrow: Story = {
  ...ScreenSheetNarrow,
  globals: { mode: "dark" },
};

// A written document's page as the open project view shows it, in one of the page's own states.
const pageOf = (args: Partial<WrittenDocumentViewProps>) =>
  paneOf({
    writtenDocument: () => (
      <WrittenDocumentView {...writtenDocument.args} {...args} />
    ),
  });

/** An older version read from the page's menu, with the note that the plan names the newest. */
export const DocumentPageOlderVersion: Story = {
  args: { ...ProjectOpen.args, ...pageOf({ ...olderVersion.args }) },
};

/** The page set against the version before it, its changes tracked inline. */
export const DocumentPageComparing: Story = {
  args: { ...ProjectOpen.args, ...pageOf({ ...comparingVersions.args }) },
};

/** The document is still being read: the open view's one loading line, with no page yet. */
export const DocumentPageLoading: Story = {
  args: { ...ProjectOpen.args, ...paneOf(loadingDocument.args) },
};

/** The document could not be read: the open view's error line with Try again, with no page. */
export const DocumentPageFailed: Story = {
  args: { ...ProjectOpen.args, ...paneOf(failedDocument.args) },
};

/** At phone width the contents give way and the page takes the view's width. */
export const DocumentPageNarrow: Story = {
  args: { ...ProjectOpen.args },
  globals: { viewport: { value: "mobile1" } },
  decorators: [
    (Story) => (
      <div style={{ width: 375, height: "100vh", margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};

export const DocumentPageNarrowDark: Story = {
  ...DocumentPageNarrow,
  globals: { ...DocumentPageNarrow.globals, mode: "dark" },
};
