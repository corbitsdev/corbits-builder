import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useState, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { wording } from "../../config.ts";
import { AppView } from "../../App.view.tsx";
import app from "../../App.stories.tsx";
import type { PlanView } from "@corbits-builder/schemas/project";
import type { ArtifactPaneProps } from "./artifact-pane.tsx";
import documentPane, {
  AppAndManual as appAndManual,
  Concepts as conceptTabs,
  DesignDraft as designDraft,
  Loading as loadingDocument,
  ReadError as failedDocument,
} from "./artifact-pane.stories.tsx";
import { coordinatorPlan, planning } from "./project-outline.fixtures.ts";
import { projectOutline, type OutlineAppState } from "./project-outline.ts";
import designer from "@plugins/designer/package.json";
import choose from "@plugins/designer/src/choose/definition.ts";
import ChooseView from "@plugins/designer/src/choose/view.tsx";
import looks from "@plugins/designer/src/looks/definition.ts";
import LooksView from "@plugins/designer/src/looks/view.tsx";
import writer from "@plugins/writer/package.json";
import approve from "@plugins/writer/src/approve/definition.ts";
import ApproveView from "@plugins/writer/src/approve/view.tsx";
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
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <RoomView
        {...args}
        layout={{
          ...args.layout,
          projectOpen,
          appShown: onScreen === LIVE_TAB,
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
    documents: pane.documents ?? [],
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
    shown: null,
    onToggleSidebar: fn(),
    onAskFirst: fn(),
    onDecline: fn(),
    onOpenApp: fn(),
    onOpenStep: fn(),
    onProjectSettings: fn(),
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
  appShown: false,
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

/**
 * A plan the coordinator wrote from plugin actions, with no ready-made plan: research, a question
 * for the person, then a command-line tool built and tried. Its steps make nothing the project view
 * opens, so the sidebar lists each one as it stands, and nothing more.
 */
export const CoordinatorPlan: Story = {
  args: { sidebar: sidebarOf({}, coordinatorPlan.plan) },
  play: async ({ canvasElement }) => {
    const plan = within(canvasElement).getByRole("tree");
    const steps = within(plan).getAllByRole("treeitem");
    await expect(steps.map((step) => step.getAttribute("title"))).toEqual(
      coordinatorPlan.plan.map((step) => step.title),
    );
  },
};

/**
 * A request too small to plan, such as a change of font: the coordinator saved no plan, so the
 * sidebar makes up no row and says only that there is no plan yet.
 */
export const NoPlan: Story = {
  args: { sidebar: sidebarOf({}, []) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("tree")).toBeNull();
  },
};

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

/** Put away while the coordinator's plan is under way: the plan stays in sight under the name. */
export const SidebarClosedPlanUnderWay: Story = {
  args: { sidebar: { ...sidebarOf({}, coordinatorPlan.plan), open: false } },
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
    // The view opens in a view transition, which updates the page a frame later.
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="room-project"]'),
      ).not.toHaveAttribute("hidden"),
    );
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

/**
 * Full screen is the room's own conversation: the project view is put away and the box, with what
 * was typed, is back under the turns. Project opens the view again.
 */
export const ChatSheetFullScreen: Story = {
  args: {
    ...chatBehindBox,
    dock: { ...composer, text: "Also take orders by" },
  },
  play: async ({ canvasElement }) => {
    await openChat(canvasElement);
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.chat.fullScreen,
      }),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="room-project"]'),
      ).toHaveAttribute("hidden"),
    );
    await expect(within(canvasElement).getByRole("textbox")).toHaveValue(
      "Also take orders by",
    );
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

const chooseScreen = storyScreen(
  "@corbits-builder/designer choose",
  designer.builder.actions["choose"],
  { screen: choose, view: ChooseView, data: undefined },
);

const screenNotNow = fn();

/**
 * A screen its plugin draws for the page waits: it stands at once in the ground right of the chat,
 * with no Close, and the box names it with Not now, the screen's forward action where Send is.
 */
export const ScreenWaiting: Story = {
  args: {
    waiting: {
      kind: "screen",
      title: "Choose a design",
      onNotNow: screenNotNow,
      disabled: false,
    },
    space: { key: "screen:story", title: "Choose a design", place: "page" },
    pluginSpace: (
      <ScreenStory
        screen={chooseScreen}
        state="open"
        input={{}}
        project={{}}
        draft={{ concept: "Crisp", version: 1, comments: [] }}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const space = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>(
        '[data-slot="plugin-space"]',
      );
      if (found === null) throw new Error("No plugin space");
      return found;
    });
    await expect(
      canvas.queryByRole("button", {
        name: wording.promptBox.waiting.openScreen,
      }),
    ).not.toBeInTheDocument();
    await expect(
      within(space).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    // The screen keeps to the ground beside the chat; the box and the turns stay where they were.
    const box = canvasElement.querySelector('[data-slot="composer-box"]');
    if (box === null) throw new Error("No prompt box");
    await expect(space.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      box.getBoundingClientRect().right,
    );
  },
};

const looksScreen = storyScreen(
  "@corbits-builder/designer looks",
  designer.builder.actions["looks"],
  { screen: looks, view: LooksView, data: undefined },
);

const approveScreen = storyScreen(
  "@corbits-builder/writer approve",
  writer.builder.actions["approve"],
  { screen: approve, view: ApproveView, data: undefined },
);

/**
 * A screen its plugin draws for the conversation is the box's card: its choices over the words,
 * its forward action where Send is, and no space beside the room.
 */
export const ScreenInBox: Story = {
  args: {
    waiting: {
      kind: "screen",
      title: "How many looks to compare",
      onNotNow: undefined,
      disabled: false,
    },
    space: {
      key: "screen:looks",
      title: "How many looks to compare",
      place: "box",
    },
    pluginSpace: (
      <ScreenStory
        screen={looksScreen}
        state="open"
        input={{ current: "two" }}
        project={{}}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(
      '[data-slot="composer"]',
    );
    await expect(box).not.toBeNull();
    if (box === null) return;
    await expect(
      within(box).getByRole("group", {
        name: "How many looks do you want to compare?",
      }),
    ).toBeInTheDocument();
    await expect(
      within(box).getByRole("button", { name: "Compare two looks" }),
    ).toBeInTheDocument();
    await expect(
      within(canvasElement).queryByRole("button", {
        name: wording.promptBox.waiting.openScreen,
      }),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-slot="plugin-space"]'),
    ).toBeNull();
  },
};

export const ScreenInBoxDark: Story = {
  ...ScreenInBox,
  globals: { mode: "dark" },
};

/** Approving documents is asked in the box, with Approve where Send is. */
export const ApproveInBox: Story = {
  args: {
    waiting: {
      kind: "screen",
      title: "Approve the documents",
      onNotNow: undefined,
      disabled: false,
    },
    space: {
      key: "screen:approve",
      title: "Approve the documents",
      place: "box",
    },
    pluginSpace: (
      <ScreenStory
        screen={approveScreen}
        state="open"
        input={{ kinds: ["build_plan"] }}
        project={{}}
        output={{
          approved: [
            { kind: "build_plan", artifactId: "artifact-plan", version: 2 },
          ],
        }}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(
      '[data-slot="composer"]',
    );
    await expect(box).not.toBeNull();
    if (box === null) return;
    await expect(
      within(box).getByText("Ready to approve the build plan?"),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-slot="plugin-space"]'),
    ).toBeNull();
  },
};

export const ApproveInBoxDark: Story = {
  ...ApproveInBox,
  globals: { mode: "dark" },
};

/** Not now turns the screen down from the box, without opening it. */
export const ScreenNotNow: Story = {
  ...ScreenWaiting,
  play: async ({ canvasElement }) => {
    screenNotNow.mockClear();
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.waiting.notNow,
      }),
    );
    await expect(screenNotNow).toHaveBeenCalledOnce();
  },
};

/** A plugin's own screen answers nothing, but Not now still sets it aside for now. */
export const ScreenOfItsOwn: Story = {
  args: {
    ...ScreenWaiting.args,
    waiting: {
      kind: "screen",
      title: "Choose a design",
      onNotNow: fn(),
      disabled: false,
    },
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.waiting.notNow,
      }),
    );
    const waiting = args.waiting;
    await expect(
      waiting?.kind === "screen" ? waiting.onNotNow : undefined,
    ).toHaveBeenCalled();
  },
};

/**
 * Over the project view the screen waits for Open in the box, which lays it over the page with the
 * box beneath; Escape puts it away again.
 */
export const ScreenWaitingProjectOpen: Story = {
  args: {
    ...ScreenWaiting.args,
    ...withDocuments,
    layout: { ...withDocuments.layout, projectOpen: true },
  },
  play: async ({ canvasElement }) => {
    const space = () =>
      canvasElement.querySelector('[data-slot="plugin-space"]');
    await expect(space()).toBeNull();
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.waiting.openScreen,
      }),
    );
    await waitFor(() => expect(space()).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(space()).toBeNull());
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

/**
 * Where the ground beside the chat is too narrow for a screen, it takes the whole page over the
 * conversation, the prompt box beneath it, with no Close and no Open.
 */
export const ScreenSheetNarrow: Story = {
  ...ScreenWaiting,
  ...narrow,
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Choose a design" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", {
        name: wording.promptBox.waiting.openScreen,
      }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
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

/** The pill's line, while the box is shrunk over the app. */
const foldLine = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>(
    '[data-slot="room-project"] [data-slot="fold-line"]',
  );

/**
 * Over the running app, the box shrinks to a pill saying what waits, its action where Send stands,
 * and the app runs to the foot of the view beneath it.
 */
export const AppScreenWaiting: Story = {
  args: { ...ScreenWaiting.args, ...AppBuilt.args },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(foldLine(canvasElement)).not.toBeNull());
    await expect(foldLine(canvasElement)).toHaveTextContent("Choose a design");
    await expect(
      canvasElement.querySelector(
        '[data-slot="room-project"] [data-slot="composer-panel"]',
      ),
    ).toHaveAttribute("hidden");
  },
};

export const AppApprovalWaiting: Story = {
  args: { ...ApprovalWaiting.args, ...AppBuilt.args },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(foldLine(canvasElement)).not.toBeNull());
    await expect(foldLine(canvasElement)).toHaveTextContent(
      wording.approval.run,
    );
  },
};

export const AppStepGoAhead: Story = {
  args: { ...StepGoAhead.args, ...AppBuilt.args },
};

/** Work running over the app: the pill says what is happening, with Stop at its end. */
export const AppWorking: Story = {
  args: {
    ...AppBuilt.args,
    chat: <RoomThread {...thread.args} />,
    dock: {
      ...composer,
      working: true,
      status: { state: "working", label: "Building the app" },
    },
  },
};

/** The app is up with nothing waiting: the pill says so behind a breathing green ring. */
export const AppLive: Story = {
  args: {
    ...AppBuilt.args,
    dock: {
      ...composer,
      status: {
        state: "running",
        label: wording.promptBox.status.appRunning,
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(foldLine(canvasElement)).not.toBeNull());
    await expect(
      foldLine(canvasElement)?.querySelector('[data-slot="bloom-ring"]'),
    ).not.toBeNull();
  },
};

export const AppLiveDark: Story = {
  ...AppLive,
  globals: { mode: "dark" },
};

/**
 * The pill opens the box with the cursor in it; a press outside, with nothing written, shrinks it
 * again.
 */
export const AppBoxOpens: Story = {
  args: { ...ApprovalWaiting.args, ...AppBuilt.args },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(foldLine(canvasElement)).not.toBeNull());
    const line = foldLine(canvasElement);
    if (line === null) throw new Error("No folded line under the app");
    await userEvent.click(line);
    const project = canvasElement.querySelector<HTMLElement>(
      '[data-slot="room-project"]',
    );
    if (project === null) throw new Error("No project view");
    const box = within(project).getByRole("textbox");
    await waitFor(() => expect(box).toHaveFocus());
    await expect(foldLine(canvasElement)).toBeNull();
    await expect(
      project.querySelector('[data-slot="composer-panel"]'),
    ).not.toHaveAttribute("hidden");
    const app = project.querySelector<HTMLElement>('[data-slot="live-app"]');
    if (app === null) throw new Error("No app in the project view");
    await userEvent.click(app);
    await waitFor(() => expect(foldLine(canvasElement)).not.toBeNull());
  },
};

export const AppScreenWaitingDark: Story = {
  ...AppScreenWaiting,
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

// The person's comments on the brief: two on passages the page shows, one on a passage a later
// version rewrote.
const briefComments: NonNullable<WrittenDocumentViewProps["comments"]> = {
  drafts: [
    {
      id: "texts",
      quote: "Counter staff who answer the phone mid-shift",
      comment:
        "Some regulars text their order to the counter. Count texts too?",
    },
    {
      id: "allergy",
      quote: "Flag allergies and dietary needs",
      comment: "Should the cake label show the allergy as well?",
    },
    {
      id: "rewritten",
      quote: "Small bakeries take cake orders by phone and lose some of them.",
      comment: "Is losing orders the real problem, or forgetting them?",
    },
  ],
  onSave: fn(),
  onDelete: fn(),
};

const commentsDock = {
  ...composer,
  comments: 3,
  onSendComments: fn(),
  onShowComments: fn(),
  onRemoveComments: fn(),
  commentsBlocked: null,
  commentsSending: false,
};

/** Comments wait to be sent: the box counts them in its typing row, and the count opens their page. */
export const CommentsWaiting: Story = {
  args: { ...withDocuments, dock: commentsDock },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const token = canvas.getByRole("button", {
      name: wording.promptBox.showComments(3),
    });
    await expect(token).toHaveTextContent(wording.promptBox.comments(3));
    await userEvent.click(token);
    if (args.dock.kind === "composer")
      await expect(args.dock.onShowComments).toHaveBeenCalledOnce();
  },
};

/** Comments on the page: each card level with its passage, one whose passage changed at the top. */
export const CommentsOnPage: Story = {
  args: {
    ...ProjectOpen.args,
    ...pageOf({ comments: briefComments }),
    dock: commentsDock,
  },
};

export const CommentsOnPageDark: Story = {
  ...CommentsOnPage,
  globals: { mode: "dark" },
};

/** Selecting a passage opens a card to write about it, the passage marked while it is written. */
export const CommentWriting: Story = {
  args: { ...CommentsOnPage.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const passage = await canvas.findByText(/^Every order is in one list/);
    const range = document.createRange();
    range.selectNodeContents(passage);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    passage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    // Where the page has no margin to spare, the card opens over it, outside the canvas.
    await waitFor(() =>
      expect(
        canvasElement.ownerDocument.querySelector(
          '[data-slot="comment-card"][data-state="writing"]',
        ),
      ).not.toBeNull(),
    );
  },
};

export const CommentWritingDark: Story = {
  ...CommentWriting,
  globals: { mode: "dark" },
};

/**
 * A press anywhere else, with nothing written, puts the card away and lets the passage go; with
 * words written, the card stays.
 */
export const CommentPutAway: Story = {
  args: { ...CommentsOnPage.args },
  play: async (context) => {
    await CommentWriting.play?.(context);
    const { canvasElement } = context;
    const writing = () =>
      canvasElement.ownerDocument.querySelector<HTMLElement>(
        '[data-slot="comment-card"][data-state="writing"]',
      );
    const heading = await within(canvasElement).findByRole("heading", {
      name: "A good Saturday",
    });
    await userEvent.click(heading);
    await waitFor(() => expect(writing()).toBeNull());

    await CommentWriting.play?.(context);
    const field = within(writing() ?? canvasElement).getByRole("textbox");
    await userEvent.type(field, "Say how many orders");
    await userEvent.click(heading);
    await expect(writing()).not.toBeNull();
  },
};

/** While the coordinator's question is open, the comments wait and the box says what comes first. */
export const CommentsWaitOnQuestion: Story = {
  args: {
    ...QuestionsOpen.args,
    dock: {
      ...commentsDock,
      placeholder: wording.questions.composerPlaceholder,
      commentsBlocked: wording.promptBox.commentsAfterQuestion,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvasElement.querySelector('[data-slot="prompt-input-submit"]'),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      canvas.getByText(wording.promptBox.commentsAfterQuestion),
    ).toBeVisible();
  },
};

/** While an approval is open, the comments wait until it is decided. */
export const CommentsWaitOnApproval: Story = {
  args: {
    ...ApprovalWaiting.args,
    dock: {
      ...commentsDock,
      placeholder: wording.approval.composerPlaceholder,
      commentsBlocked: wording.promptBox.commentsAfterApproval,
    },
  },
};

export const CommentsWaitOnApprovalDark: Story = {
  ...CommentsWaitOnApproval,
  globals: { mode: "dark" },
};

/** The comments on their way, the half-typed message left in the box. */
export const CommentsSending: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...commentsDock,
      text: "Also take orders by",
      commentsSending: true,
    },
  },
};

/** Sending failed: the comments are all still there, and the count sends them again. */
export const CommentsSendFailed: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...commentsDock,
      sendFault: "That message was not sent.",
    },
  },
};

/** On a narrow room the count stays in the typing row. */
export const CommentsWaitingNarrow: Story = {
  args: { ...CommentsWaiting.args },
  ...narrow,
};

export const CommentsWaitingNarrowDark: Story = {
  ...CommentsWaitingNarrow,
  globals: { mode: "dark" },
};

/** At phone width the passages keep their underlines and open their cards from them. */
export const CommentsOnPageNarrow: Story = {
  ...DocumentPageNarrow,
  args: { ...CommentsOnPage.args },
};

export const CommentsOnPageNarrowDark: Story = {
  ...CommentsOnPageNarrow,
  globals: { ...DocumentPageNarrow.globals, mode: "dark" },
};
