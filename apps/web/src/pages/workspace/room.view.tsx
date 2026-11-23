/**
 * The project room as it looks: the conversation with the coordinator across the page, the dock
 * beneath it (the composer, or a banner saying why there is none), the project view that opens
 * over it from a card or the project control and closes back to the conversation, and the plugin
 * space beside them both, where every plugin screen opens.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import {
  FolderOpen,
  MessageSquare,
  Plus,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  Attachment,
  type AttachmentItem,
  AttachmentDropZone,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  Button as UiButton,
  ConversationEmptyState,
  PromptInput,
  PromptInputButton,
  PromptInputFloat,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@corbits/react-ui";
import type { ScreenStatus } from "@corbits-builder/plugin";
import type {
  PromptQuestion,
  QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import { Banner, BannerAction, Fault } from "../../components.jsx";
import { Composer } from "../../composer.tsx";
import { Dictated } from "../../dictation.jsx";
import { useShellReply } from "../../flourish.tsx";
import {
  ArtifactPane,
  type ArtifactPaneContent,
  type ArtifactPaneSlots,
} from "./artifact-pane.tsx";
import { InBox, useBoxPorts, type BoxPorts } from "./box-ports.tsx";
import { ScreenCard, StepCard } from "./box-cards.tsx";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";
import { FootFade } from "./foot-fade.tsx";
import { PluginSpace } from "./plugin-space.tsx";
import { QuestionsCard } from "./questions-card.tsx";
import type { DocumentApproval } from "./transcript.tsx";
import { TypedYesCountdown, type TypedYes } from "./typed-yes.tsx";
import { pastedFiles } from "./pasted-files.ts";
import { ChatSheet, type ChatSheetProps } from "./chat-sheet.tsx";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
} from "./project-sidebar.view.tsx";
import type { StatusPillContent } from "./status-pill.tsx";
import { StageView } from "./stage-view.tsx";
import { RoomThread, type RoomThreadContent } from "./transcript.tsx";
import styles from "./index.module.css";

/** The parts of the room that read the hub for themselves, which the page fills. */
export type RoomSlots = {
  /** The reading pane's own such parts. */
  paneParts: ArtifactPaneSlots;
  /** The plugin screen the plugin space shows, the first that waits; null while none does. */
  pluginSpace: ReactNode;
  /**
   * The conversation for the chat sheet that pulls up around the prompt box over the project view
   * or a page. The room's own conversation already shows the thread, so its box has no sheet.
   * Absent, no box has a handle.
   */
  chat?: ReactNode;
};

/**
 * Puts away what covers the conversation, or brings the project view back over it, as one motion:
 * the chat's surface grows from the sheet to the page or shrinks from the page into the box, the
 * lines and the box keep their place, and the view fades under it. The parts are named only while
 * it runs, in index.module.css.
 */
function swapCover(to: "chat" | "project", update: () => void) {
  const root = document.documentElement;
  if (
    typeof document.startViewTransition !== "function" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return update();
  root.dataset.roomMorph = to;
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => delete root.dataset.roomMorph);
}

/** The box the person writes to the coordinator in. */
export type RoomComposer = {
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  /** The box itself, which the room puts the cursor in. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** A specialist is at work, so Stop stands where Send is while the box is empty. */
  working: boolean;
  /** A message or a decision is on its way to the hub, so the box waits. */
  busy: boolean;
  /** Nothing can be written yet. */
  disabled: boolean;
  /** No model provider is connected, so the box takes nothing and offers to connect one in place of sending. */
  needsProvider: boolean;
  onEnableAi: () => void;
  attachments: {
    files: readonly AttachmentItem[];
    /** The kinds of file the hub reads, for the file picker; null where it names none. */
    accept: string | null;
    /** Why a file was not taken, or why the files were not sent. */
    fault: string | null;
    onAdd: (files: ArrayLike<File>) => void;
    onRemove: (id: string) => void;
  };
  /** Why the last message did not reach the coordinator. */
  sendFault: string | null;
  /** What sending these words would restart, as they name a document work builds from; null when nothing. */
  restarts: string | null;
  /** The answers the coordinator's last message offers, each sent as it is. */
  suggestedReplies: readonly string[];
  onReply: (reply: string) => void;
  /** What Send says, beside it and as its name, while an open screen has feedback to send with nothing typed. */
  sendLabel: string | null;
  /** What is happening, in the pill above the box; null or absent while nothing is. */
  status?: StatusPillContent | null;
  /** Comments on a document waiting to be made, as a token in the typing row; Send makes them, with or without words. */
  comments?: number;
  /** Stops the specialists at work; Stop stands in for Send while the box is empty. */
  onStop?: () => void;
};

/**
 * The one thing the prompt box holds for the person to deal with, the first of what waits on them:
 * the coordinator's question, an approval, a step held for their go-ahead, or a plugin's screen
 * waiting in the plugin space.
 */
export type BoxWaiting =
  | {
      kind: "question";
      question: PromptQuestion;
      disabled: boolean;
      onAnswer: (answer: QuestionAnswer) => Promise<boolean>;
    }
  | {
      kind: "approval";
      approval: DocumentApproval;
      disabled: boolean;
      /** Why the last decision was not saved. */
      error: string | null;
      /** A typed yes counting down to approve it. */
      typedYes: { held: TypedYes; onUndo: () => void } | null;
      onDecide: (choice: "yes" | "always" | "no") => void;
    }
  | {
      kind: "step";
      title: string;
      busy: boolean;
      onGoAhead: () => void;
    }
  | { kind: "screen"; title: string };

/** What sits under the conversation: the composer, or why the person cannot write yet. */
export type RoomDock =
  | {
      kind: "archived";
      restoring: boolean;
      /** Why the project could not be restored. */
      fault: string | null;
      onRestore: () => void;
    }
  | {
      kind: "modelNeeded";
      /** Why the coordinator has no model to run on, in the hub's words. */
      message: string;
      onOpenSettings: () => void;
      onRetry: () => void;
    }
  | { kind: "starting" }
  | {
      kind: "startFailed";
      /** Why the coordinator did not start. */
      message: string;
      onRetry: () => void;
    }
  | ({ kind: "composer" } & RoomComposer);

/** What the room shows and what the person can do in it. */
export type RoomContent = {
  /** The project's name. */
  title: string;
  layout: {
    /** Something is filed, drafted or running, so the project view has something to show. */
    projectReady: boolean;
    /** The project view covers the room, with the prompt box beneath it; closed, it waits hidden. */
    projectOpen: boolean;
    onProjectOpenChange: (open: boolean) => void;
  };
  conversation: {
    thread: RoomThreadContent;
    /** What stands in the thread's place: an archived project's note, or a new project's welcome. */
    empty: "archived" | "new" | null;
  };
  dock: RoomDock;
  /** The project's sidebar: its plan, its app and the ways out of the room. */
  sidebar: Omit<ProjectSidebarViewProps, "drawer">;
  /** What the prompt box holds for the person to deal with; null while nothing waits. */
  waiting: BoxWaiting | null;
  /**
   * The plugin screen waiting first, which the plugin space shows by this name; null while none
   * does, and then there is no space. Its key changes when another screen takes its place.
   */
  space: { key: string; title: string } | null;
  documentPane: ArtifactPaneContent;
  /** Where each plugin tab that says so stands, beside the plan, each opening its tab. */
  tabStatus: readonly TabStatus[];
  /** The project view's pane, which takes focus as it opens. */
  paneRef: RefObject<HTMLElement | null>;
};

export type TabStatus = ScreenStatus & { tab: string; onOpen: () => void };

/**
 * Below this width of the room, the sidebar is a drawer over the page and the plugin space a sheet
 * over the main area, since neither has room for a column.
 */
const NARROW_ROOM_PX = 900;

export type RoomViewProps = RoomContent & RoomSlots;

export function RoomView({
  title,
  layout,
  conversation,
  dock,
  sidebar,
  waiting,
  space,
  documentPane,
  tabStatus,
  paneRef,
  paneParts,
  pluginSpace,
  chat,
}: RoomViewProps) {
  const { projectReady, projectOpen, onProjectOpenChange } = layout;
  const conversationRef = useRef<HTMLElement>(null);
  const shell = useShellReply(conversationRef);
  const closeProject = () => onProjectOpenChange(false);
  // The sidebar sits beside the page and the plugin space beside the main area; in a room too
  // narrow for that the sidebar is a drawer, shut until the person opens it, and shut again once
  // they pick something in it, and the space is a sheet.
  const roomRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Measured before the first paint too, so a phone never draws the wide room first.
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (room === null) return;
    const measure = () => setNarrow(room.clientWidth < NARROW_ROOM_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(room);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);
  // The box floats over the project view's foot, so the view keeps what it must reach clear of it
  // by the box's height, which grows as the person writes.
  const projectRef = useRef<HTMLDivElement>(null);
  // Set before paint, so the view's first frame already keeps clear of the box.
  useLayoutEffect(() => {
    const page = projectRef.current;
    const box = page?.querySelector<HTMLElement>(
      ':scope > [data-slot="composer"]',
    );
    if (page === null || page === undefined) return;
    // Checked on every render, as the box comes and goes with what stands in its place; the
    // height stays set between renders so the view's foot never jumps while it is read again.
    if (box === null || box === undefined) {
      page.style.removeProperty("--box-height");
      page.style.removeProperty("--dock-height");
      return;
    }
    // The box at rest: while the chat is pulled up over the view, the view keeps the foot it had.
    const measure = () => {
      if (
        box.querySelector('[data-slot="chat-sheet"]:not([data-state="closed"])')
      )
        return;
      page.style.setProperty("--box-height", `${String(box.offsetHeight)}px`);
      // The box with the pill or handle standing above it, which the running app ends above, as it
      // cannot run on beneath them the way a page does.
      const grip = box.querySelector<HTMLElement>('[data-slot="chat-grip"]');
      const top = box.getBoundingClientRect().top;
      const reach =
        grip === null ? 0 : Math.max(0, top - grip.getBoundingClientRect().top);
      page.style.setProperty(
        "--dock-height",
        `${String(Math.ceil(box.offsetHeight + reach))}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const grip = box.querySelector('[data-slot="chat-grip"]');
    if (grip !== null) observer.observe(grip);
    return () => observer.disconnect();
  });
  const leaveDrawer =
    <Args extends unknown[]>(go: (...args: Args) => void) =>
    (...args: Args) => {
      setDrawerOpen(false);
      go(...args);
    };
  // On a wide window the space stands beside the main area as soon as a screen waits, taking no
  // focus; on a narrow one it waits until the person opens it as a sheet, and Close puts it away.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetShown = narrow && sheetOpen && space !== null;
  const columnShown = !narrow && space !== null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = dock.kind === "composer" ? dock.inputRef : null;
  const openSpace = () => {
    if (narrow && !sheetOpen) setSheetOpen(true);
    else headingRef.current?.focus();
  };
  // The box moves with the sheet, so the cursor goes back to it once it has moved.
  const refocusBox = useRef(false);
  const closeSheet = () => {
    setSheetOpen(false);
    refocusBox.current = true;
  };
  // The sheet takes focus to its heading as it opens.
  useEffect(() => {
    if (sheetShown) headingRef.current?.focus();
  }, [sheetShown]);
  // Once a screen is submitted the next takes its place, or the space closes; either way the
  // person carries on in the prompt box, with what they had typed still there.
  const spaceKey = space?.key ?? null;
  const shownKey = useRef(spaceKey);
  useEffect(() => {
    const before = shownKey.current;
    shownKey.current = spaceKey;
    if (before === null || before === spaceKey) return;
    if (spaceKey === null) setSheetOpen(false);
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      (active instanceof HTMLElement &&
        active.closest('[data-slot="plugin-space"]') !== null);
    if (lost) refocusBox.current = true;
  }, [spaceKey]);
  useEffect(() => {
    if (!refocusBox.current) return;
    refocusBox.current = false;
    inputRef?.current?.focus();
  });
  // Focus goes into the project view as it opens and back to what opened it as it closes.
  useEffect(() => {
    if (!projectOpen) return;
    const opener = document.activeElement;
    paneRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [projectOpen]);
  // Escape puts the sheet away first; a menu inside the view closes on Escape before that, and
  // marks the key as used.
  useEffect(() => {
    if (!projectOpen && !sheetShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sheetShown) return closeSheet();
      // An open chat sheet takes the key to put itself back, whichever listener hears it first;
      // the view closes on the next one.
      const sheet =
        roomRef.current?.querySelector(
          '[data-slot="chat-sheet"]:not([data-state="closed"])',
        ) ?? null;
      if (sheet === null) closeProject();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [projectOpen, sheetShown]);
  // The prompt box stays in reach under whatever covers the conversation.
  const dockInSheet = sheetShown;
  const dockInProject = projectOpen && !sheetShown;
  const dockInConversation = !projectOpen && !sheetShown;
  // A screen in the plugin space reaches the box: its forward action, placeholder and Send.
  const ports = useBoxPorts();
  const card = waitingCard(waiting, openSpace);
  const conversationDock = (
    <RoomDockView
      dock={dock}
      ports={ports}
      waiting={card}
      answersShell={shell.answers}
    />
  );
  // Full screen is the room's own conversation: what the chat was pulled up over is put away.
  const roomDock = (
    <RoomDockView
      dock={dock}
      ports={ports}
      waiting={card}
      chat={chat}
      chatStart={{
        onFullScreen: () =>
          swapCover(
            "chat",
            dockInSheet ? closeSheet : () => onProjectOpenChange(false),
          ),
      }}
      answersShell={shell.answers}
    />
  );
  // The screen the box lists is the one that hands its action to the box; any other keeps its own.
  const spaceScreen =
    space === null ? null : (
      <InBox ports={ports} as={waiting?.kind === "screen" ? "space" : null}>
        {pluginSpace}
      </InBox>
    );
  return (
    <StageView aria-label={`Conversation for ${title}`}>
      <div ref={roomRef} className={styles.room}>
        <ProjectSidebarView
          {...sidebar}
          open={narrow ? drawerOpen : sidebar.open}
          drawer={narrow}
          onToggleSidebar={
            narrow ? () => setDrawerOpen(!drawerOpen) : sidebar.onToggleSidebar
          }
          onOpenApp={leaveDrawer(sidebar.onOpenApp)}
          onOpenStep={leaveDrawer(sidebar.onOpenStep)}
        />
        {/* The page beside the sidebar: the conversation, and what covers it. */}
        <div className={styles.main} data-slot="room-main">
          <section
            ref={conversationRef}
            className={styles.conversationPane}
            aria-label="Project conversation"
          >
            <div className={styles.conversation}>
              <div className={styles.top}>
                {projectReady ? (
                  <div className={styles.controls}>
                    {tabStatus.map(({ tab, label, mark, onOpen }) => (
                      <UiButton
                        key={tab}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={styles.control}
                        aria-label={wording.conversation.tabStatus(tab, label)}
                        title={wording.conversation.openTab(tab)}
                        onClick={onOpen}
                      >
                        <span>{label}</span>
                        {mark === undefined ? null : (
                          <span className={styles.alert} data-mark={mark} />
                        )}
                      </UiButton>
                    ))}
                    <UiButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={styles.control}
                      aria-label={wording.conversation.openProject}
                      title={wording.conversation.openProjectHint}
                      onClick={() =>
                        swapCover("project", () => onProjectOpenChange(true))
                      }
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                      <span className={styles.label}>
                        {wording.conversation.openProject}
                      </span>
                    </UiButton>
                  </div>
                ) : null}
              </div>
              <RoomThread {...conversation.thread}>
                <EmptyConversation empty={conversation.empty} />
              </RoomThread>
              {dockInConversation ? conversationDock : null}
            </div>
          </section>
          {projectReady ? (
            // Kept while closed, so its panes, previews and drafts keep their place.
            <div
              ref={projectRef}
              className={styles.page}
              data-slot="room-project"
              hidden={!projectOpen}
            >
              <ArtifactPane
                {...documentPane}
                {...paneParts}
                paneRef={paneRef}
                open={projectOpen}
              />
              {/* Shown only under a box floating over a written page, which runs on beneath it. */}
              <div className={styles.footFade}>
                <FootFade />
              </div>
              {dockInProject ? roomDock : null}
            </div>
          ) : null}
          {sheetShown && space !== null ? (
            <div className={styles.page} data-slot="room-space-sheet">
              <PluginSpace
                title={space.title}
                as="sheet"
                headingRef={headingRef}
                onClose={closeSheet}
              >
                {spaceScreen}
              </PluginSpace>
              {dockInSheet ? roomDock : null}
            </div>
          ) : null}
        </div>
        {columnShown && space !== null ? (
          <PluginSpace title={space.title} as="column" headingRef={headingRef}>
            {spaceScreen}
          </PluginSpace>
        ) : null}
      </div>
      {shell.reply}
    </StageView>
  );
}

/** What waits on the person as the card the prompt box holds; a screen's card opens the space. */
function waitingCard(
  waiting: BoxWaiting | null,
  openSpace: () => void,
): ReactNode {
  if (waiting === null) return undefined;
  switch (waiting.kind) {
    case "question":
      return (
        <QuestionsCard
          question={waiting.question}
          disabled={waiting.disabled}
          onAnswer={waiting.onAnswer}
        />
      );
    case "approval": {
      const { approval, typedYes, error, onDecide } = waiting;
      const countdown =
        typedYes !== null &&
        typedYes.held.approvalId === approval.approvalId ? (
          <TypedYesCountdown held={typedYes.held} onUndo={typedYes.onUndo} />
        ) : undefined;
      return approval.packages ? (
        <PackageDecision
          approvalId={approval.approvalId}
          packages={approval.packages}
          disabled={waiting.disabled}
          {...(error === null ? {} : { error })}
          onYes={() => onDecide("yes")}
          onAlways={() => onDecide("always")}
          onNo={() => onDecide("no")}
          countdown={countdown}
        />
      ) : (
        <DocumentDecision
          place="box"
          approval={approval}
          disabled={waiting.disabled}
          {...(error === null ? {} : { error })}
          onYes={() => onDecide("yes")}
          onAlways={() => onDecide("always")}
          onNo={() => onDecide("no")}
          countdown={countdown}
        />
      );
    }
    case "step":
      return (
        <StepCard
          title={waiting.title}
          busy={waiting.busy}
          onGoAhead={waiting.onGoAhead}
        />
      );
    case "screen":
      return <ScreenCard title={waiting.title} onOpen={openSpace} />;
    default:
      return waiting satisfies never;
  }
}

function EmptyConversation({ empty }: { empty: "archived" | "new" | null }) {
  if (empty === "archived")
    return (
      <ConversationEmptyState
        title={wording.archivedProject.conversationTitle}
        description={wording.archivedProject.conversationLead}
      />
    );
  if (empty === "new")
    return (
      <ConversationEmptyState
        title={wording.conversation.empty}
        description={wording.conversation.emptyLead}
      />
    );
  return null;
}

/** Takes a shell request typed into the composer, so it is answered rather than sent. */
type AnswersShell = (text: string) => boolean;

/** Where the chat sheet starts, before the person moves it. */
type ChatStart = Pick<
  ChatSheetProps,
  "defaultState" | "defaultPull" | "onFullScreen"
>;

/**
 * What sits under the conversation: the prompt box with its pill, handle and chat sheet, or the
 * banner saying why there is none. Stories draw the dock's states with it.
 */
export function RoomDockView({
  dock,
  waiting,
  chat,
  chatStart,
  ports,
  answersShell,
}: {
  dock: RoomDock;
  /** Shared with a screen over the page, so it reaches this box; the box keeps its own otherwise. */
  ports?: BoxPorts | undefined;
  /**
   * What waits on the person inside the box, as the card the conversation would show it in: a
   * question card, a plugin's screen or an approval. Absent while nothing does.
   */
  waiting?: ReactNode;
  chat?: ReactNode;
  chatStart?: ChatStart | undefined;
  answersShell?: AnswersShell;
}) {
  if (dock.kind === "archived")
    return (
      <div className={styles.archived}>
        <div className={styles.caution}>
          <p>{wording.archivedProject.notice}</p>
          <UiButton
            type="button"
            size="sm"
            variant="outline"
            disabled={dock.restoring}
            onClick={dock.onRestore}
          >
            {dock.restoring
              ? wording.archivedProject.restoring
              : wording.archivedProject.restore}
          </UiButton>
        </div>
        {dock.fault === null ? null : <Fault>{dock.fault}</Fault>}
      </div>
    );
  if (dock.kind === "modelNeeded")
    return (
      <div className={styles.notice}>
        <Banner tone="error" role="alert" title={dock.message}>
          <BannerAction>
            <UiButton
              type="button"
              size="sm"
              variant="outline"
              onClick={dock.onOpenSettings}
            >
              {wording.action.openSettings}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={dock.onRetry}
            >
              {wording.action.retry}
            </UiButton>
          </BannerAction>
        </Banner>
      </div>
    );
  if (dock.kind === "starting")
    return (
      <div className={styles.notice}>
        <Banner title={wording.conversation.startingCoordinator} />
      </div>
    );
  if (dock.kind === "startFailed")
    return (
      <div className={styles.notice}>
        <Banner tone="error" role="alert" title={dock.message}>
          <BannerAction>
            <UiButton
              type="button"
              size="sm"
              variant="outline"
              onClick={dock.onRetry}
            >
              {wording.action.retry}
            </UiButton>
          </BannerAction>
        </Banner>
      </div>
    );
  return (
    <RoomComposerView
      {...dock}
      waiting={waiting}
      chat={chat}
      chatStart={chatStart}
      ports={ports}
      answersShell={answersShell}
    />
  );
}

function RoomComposerView({
  text,
  onTextChange,
  onSend,
  placeholder,
  inputRef,
  working,
  busy,
  disabled,
  needsProvider,
  onEnableAi,
  attachments,
  sendFault,
  restarts,
  suggestedReplies,
  onReply,
  sendLabel,
  status = null,
  comments = 0,
  onStop,
  waiting,
  chat,
  chatStart,
  ports: shared,
  answersShell,
}: RoomComposer & {
  waiting: ReactNode;
  chat: ReactNode;
  chatStart?: ChatStart | undefined;
  ports?: BoxPorts | undefined;
  answersShell?: AnswersShell | undefined;
}) {
  const own = useBoxPorts();
  const ports = shared ?? own;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { files } = attachments;
  const accept = needsProvider ? null : attachments.accept;
  // Files can be attached while the hub offers kinds it reads, the provider is set and nothing is
  // mid-send; the drop zone, the attach button and a paste all follow this.
  const attaching = accept !== null && !busy;
  const typed = text.trim() !== "" || files.length > 0;
  const send = () => {
    if (files.length === 0 && answersShell?.(text) === true)
      return onTextChange("");
    // A screen in the box takes the words with what is picked in it, so the pick is not lost.
    const words = text.trim();
    if (files.length === 0 && words !== "" && ports.take?.(words) === true)
      return onTextChange("");
    onSend();
  };
  const stopping = working && onStop !== undefined && !typed;
  const box = (
    <AttachmentDropZone
      onFiles={attachments.onAdd}
      disabled={!attaching}
      label={wording.conversation.dropFiles}
    >
      <Dictated value={text} onValueChange={onTextChange}>
        {(mic) => (
          <PromptInput
            value={text}
            onValueChange={onTextChange}
            onSubmit={send}
            // While a message is on its way only Send waits: the box and its words stay as they are.
            canSubmit={!busy && (typed || sendLabel !== null || comments > 0)}
            status={stopping ? "streaming" : "ready"}
            disabled={disabled || needsProvider}
          >
            {files.length === 0 ? null : (
              <PromptInputFloat>
                <Attachments
                  variant="stack"
                  total={files.length}
                  returnFocusTo={inputRef}
                >
                  {files.map((item) => (
                    <Attachment key={item.id} data={item}>
                      <AttachmentPreview />
                      <AttachmentInfo />
                      <AttachmentRemove
                        onClick={() => attachments.onRemove(item.id)}
                      />
                    </Attachment>
                  ))}
                </Attachments>
              </PromptInputFloat>
            )}
            {/* Attach leads the row; what is sent with the words follows it, then the words. */}
            {accept === null ? null : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  accept={accept}
                  onChange={(event) => {
                    if (event.target.files !== null)
                      attachments.onAdd(event.target.files);
                    event.target.value = "";
                  }}
                />
                <PromptInputButton
                  data-attach=""
                  aria-label={wording.attach.add}
                  title={wording.attach.add}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={16} aria-hidden="true" />
                </PromptInputButton>
              </>
            )}
            {comments > 0 ? (
              <span className={styles.commentsToken}>
                <MessageSquare size={12} aria-hidden="true" />
                {wording.promptBox.comments(comments)}
              </span>
            ) : null}
            <PromptInputTextarea
              ref={inputRef}
              // A picture on the clipboard attaches like a chosen file, while attaching is
              // offered at all; text, and anything else, pastes as the browser would.
              onPaste={(event) => {
                if (!attaching) return;
                const pasted = pastedFiles(event.clipboardData);
                if (pasted.length === 0) return;
                event.preventDefault();
                attachments.onAdd(pasted);
              }}
              placeholder={
                needsProvider
                  ? wording.conversation.enableAiFirst
                  : comments > 0
                    ? wording.promptBox.commentsPlaceholder
                    : (ports.placeholder ?? placeholder)
              }
            />
            <PromptInputToolbar>
              {needsProvider ? null : mic}
              {needsProvider ? (
                <UiButton
                  type="button"
                  size="sm"
                  className="ms-auto"
                  onClick={onEnableAi}
                >
                  {wording.action.enableAi}
                  <Sparkles size={14} aria-hidden="true" />
                </UiButton>
              ) : (
                <>
                  {/* The row's one action: what waits on the person hands its buttons here, where
                      they stand in for Send until the person types; Send stands while it is empty.
                      Kept while the person types, only hidden, so its buttons keep their place
                      and focus. */}
                  <div
                    ref={ports.setActionsAt}
                    data-slot="composer-actions"
                    hidden={typed}
                  />
                  {sendLabel === null ? null : (
                    <span
                      className={styles.sendLabel}
                      data-slot="send-label"
                      aria-hidden="true"
                    >
                      {sendLabel}
                    </span>
                  )}
                  <PromptInputSubmit
                    {...(stopping ? { onStop } : {})}
                    aria-label={sendLabel ?? undefined}
                    aria-busy={busy || undefined}
                  />
                </>
              )}
            </PromptInputToolbar>
          </PromptInput>
        )}
      </Dictated>
    </AttachmentDropZone>
  );
  return (
    <Composer
      panel={
        restarts !== null || waiting !== undefined ? (
          <>
            <InBox ports={ports} as={waiting === undefined ? null : "card"}>
              {waiting}
            </InBox>
            {/* Nearest the words it is about, after anything else that waits. */}
            {restarts === null ? null : (
              <p className={styles.restarts} role="status">
                <TriangleAlert size={14} aria-hidden="true" />
                {restarts}
              </p>
            )}
          </>
        ) : undefined
      }
      // Always the sheet, even with nothing to pull up, so the box is never remounted (and never
      // loses the cursor) when work starts and the pill appears. Putting the chat back returns the
      // cursor to the words, where the person left them.
      around={(inner) => (
        <ChatSheet
          {...chatStart}
          status={status}
          box={inner}
          putBackTo={inputRef}
        >
          {chat}
        </ChatSheet>
      )}
      notes={
        <>
          {attachments.fault === null ? null : (
            <Fault>{attachments.fault}</Fault>
          )}
          {sendFault === null ? null : <Fault>{sendFault}</Fault>}
          {suggestedReplies.length > 0 && !needsProvider ? (
            <div
              className={styles.replies}
              role="group"
              aria-label="Suggested replies"
            >
              {suggestedReplies.map((reply) => (
                <UiButton
                  key={reply}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onReply(reply)}
                >
                  {reply}
                </UiButton>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      {box}
    </Composer>
  );
}
