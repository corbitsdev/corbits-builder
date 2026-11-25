/**
 * The project room as it looks: the conversation with the coordinator across the page, the dock
 * beneath it (the composer, or a banner saying why there is none), the project view that opens
 * over it from a card or the sidebar and closes back to the conversation, and the plugin
 * space beside them both, where every plugin screen opens.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { MessageSquare, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
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
import { RoomFrame } from "./room-frame.tsx";
import { SketchingShown } from "./sketching.tsx";
import type { StatusPillContent } from "./status-pill.tsx";
import { StageView } from "./stage-view.tsx";
import { RoomThread, type RoomThreadContent } from "./transcript.tsx";
import styles from "./index.module.css";

/** The parts of the room that read the hub for themselves, which the page fills. */
export type RoomSlots = {
  /** The reading pane's own such parts. */
  paneParts: ArtifactPaneSlots;
  /**
   * The plugin screen waiting first, drawn where its plugin says: in the plugin space, or inside
   * the box's card; null while none does.
   */
  pluginSpace: ReactNode;
  /**
   * The conversation for the chat sheet that pulls up around the prompt box over the project view
   * or a page. The room's own conversation already shows the thread, so over it the box has none.
   * Absent, no box has a handle.
   */
  chat?: ReactNode;
  /** The project's own menu, opened from its name in the sidebar; absent, the name is just shown. */
  projectMenu?: ProjectSidebarViewProps["menu"];
};

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
  /**
   * Comment drafts waiting to be sent, as a token in the typing row. The token opens the page
   * they are on and its cross removes them; Send sends them as one message, with any words typed
   * after them.
   */
  comments?: number;
  onSendComments?: (words?: string) => void;
  onShowComments?: () => void;
  onRemoveComments?: () => void;
  /** Why the comments cannot be sent now, naming what to deal with first; null while they can. */
  commentsBlocked?: string | null;
  /** The comments are on their way. */
  commentsSending?: boolean;
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
  | {
      kind: "screen";
      title: string;
      /** It asks the person to accept what it is about, such as a document to approve. */
      decides: boolean;
    };

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
    /** The project view shows a written document, open on its page. */
    documentShown: boolean;
    /** What a written page lies on: grey, raised as a sheet over a fade at its foot, or plain white. */
    documentGround: "grey" | "white";
    onCloseProject: () => void;
  };
  conversation: {
    thread: RoomThreadContent;
    /** What stands in the thread's place: an archived project's note, or a new project's welcome. */
    empty: "archived" | "new" | null;
  };
  dock: RoomDock;
  /** The project's sidebar: its plan, its app and the ways out of the room. */
  sidebar: ProjectSidebarViewProps;
  /** What the prompt box holds for the person to deal with; null while nothing waits. */
  waiting: BoxWaiting | null;
  /**
   * The plugin screen waiting first, by this name, and where its plugin draws it: a screen for the
   * page opens in the plugin space, any other inside the box's card. Null while none does, and
   * then there is no space. Its key changes when another screen takes its place.
   */
  space: { key: string; title: string; place: "page" | "box" } | null;
  documentPane: ArtifactPaneContent;
  /** Where each plugin tab that says so stands, beside the plan, each opening its tab. */
  tabStatus: readonly TabStatus[];
  /** The project view's pane, which takes focus as it opens. */
  paneRef: RefObject<HTMLElement | null>;
};

export type TabStatus = ScreenStatus & { tab: string; onOpen: () => void };

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
  projectMenu,
}: RoomViewProps) {
  const {
    projectReady,
    projectOpen,
    documentShown,
    documentGround,
    onCloseProject: closeProject,
  } = layout;
  const conversationRef = useRef<HTMLElement>(null);
  const shell = useShellReply(conversationRef);
  const mainRef = useRef<HTMLDivElement>(null);
  // The box floats over the foot of the project view and of a screen over the conversation, so
  // each keeps what it must reach clear of it by the box's height, which grows as the person writes.
  const dockRef = useRef<HTMLDivElement>(null);
  // Set before paint, so the page's first frame already keeps clear of the box.
  useLayoutEffect(() => {
    const main = mainRef.current;
    const box = dockRef.current;
    if (main === null || box === null) return;
    // The pill or handle standing above the box, which a view that fills the pane ends above too,
    // so nothing of it shows beneath them. Found on every render, as it comes and goes.
    const grip = box.querySelector<HTMLElement>('[data-slot="chat-grip"]');
    // The box at rest: while the chat is pulled up over the view, the view keeps the foot it had.
    const measure = () => {
      if (
        box.querySelector('[data-slot="chat-sheet"]:not([data-state="closed"])')
      )
        return;
      main.style.setProperty("--box-height", `${String(box.offsetHeight)}px`);
      const top = box.getBoundingClientRect().top;
      const reach =
        grip === null ? 0 : Math.max(0, top - grip.getBoundingClientRect().top);
      main.style.setProperty(
        "--dock-height",
        `${String(Math.ceil(box.offsetHeight + reach))}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (grip !== null) observer.observe(grip);
    return () => observer.disconnect();
  });
  // Only a screen its plugin draws for the page has a space; any other is in the box. Over the
  // conversation it takes the whole page, the box beneath it, since a mockup or a set of designs
  // needs the width. Over the project view it waits for Open in the box. Answering it puts it away;
  // so does closing it, which leaves it waiting in the box to open again.
  const side = space?.place === "page" ? space : null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const sheetShown =
    side !== null &&
    (sheetOpen || (!projectOpen && closedKey !== (space?.key ?? null)));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = dock.kind === "composer" ? dock.inputRef : null;
  const openSpace = () => {
    setClosedKey(null);
    if (!sheetOpen) setSheetOpen(true);
    else headingRef.current?.focus();
  };
  // Closing takes away the control that had the cursor, so it goes back to the box.
  const refocusBox = useRef(false);
  const closeSheet = () => {
    setSheetOpen(false);
    setClosedKey(space?.key ?? null);
    refocusBox.current = true;
  };
  // A space the person opened from the box takes focus to its heading; one that comes of its own
  // accord leaves the cursor where it is.
  useEffect(() => {
    if (sheetOpen) headingRef.current?.focus();
  }, [sheetOpen]);
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
  // Escape puts the space away first; a menu inside the view closes on Escape before that, and
  // marks the key as used.
  useEffect(() => {
    if (!projectOpen && !sheetShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sheetShown) return closeSheet();
      // An open chat sheet takes the key to put itself back, whichever listener hears it first;
      // the view closes on the next one.
      const sheet =
        mainRef.current?.querySelector(
          '[data-slot="chat-sheet"]:not([data-state="closed"])',
        ) ?? null;
      if (sheet === null) closeProject();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [projectOpen, sheetShown]);
  // How many sketches at work are on the project's page.
  const [sketches, setSketches] = useState(0);
  const showSketch = useCallback(() => {
    setSketches((count) => count + 1);
    return () => setSketches((count) => count - 1);
  }, []);
  // The project view is in sight unless the plugin sheet covers it too.
  const projectShown = projectOpen && !sheetShown;
  // A screen in the plugin space reaches the box: its forward action, placeholder and Send.
  const ports = useBoxPorts();
  const card = waitingCard(
    waiting,
    sheetShown ? undefined : openSpace,
    space?.place === "box" ? pluginSpace : null,
  );
  // Over the page it asks the person to accept, a document or a screen such as a mockup's review,
  // what waits would only repeat the page: the box shows its typing row and action alone.
  // A screen open over the page is itself what waits, so the box shows its typing row alone.
  const decidesPage =
    (projectShown && documentShown && decides(waiting)) ||
    (sheetShown && waiting?.kind === "screen");
  // Covered, the conversation is out of sight, so the box has the chat to pull up and its pill says
  // what is running. Full screen is the room's own conversation: what the chat was pulled up over
  // is put away.
  const covered = projectOpen || sheetShown;
  const fullScreen = sheetShown ? closeSheet : closeProject;
  // The screen the box lists is the one that hands its action to the box; any other keeps its own.
  const spaceScreen =
    side === null ? null : (
      <InBox ports={ports} as={waiting?.kind === "screen" ? "space" : null}>
        {pluginSpace}
      </InBox>
    );
  return (
    <StageView aria-label={`Conversation for ${title}`}>
      <RoomFrame
        sidebar={<ProjectSidebarView {...sidebar} menu={projectMenu} />}
      >
        <div ref={mainRef} className={styles.main} data-slot="room-main">
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
                  </div>
                ) : null}
              </div>
              <RoomThread {...conversation.thread}>
                <EmptyConversation empty={conversation.empty} />
              </RoomThread>
            </div>
          </section>
          {projectReady ? (
            // Kept while closed, so its panes, previews and drafts keep their place.
            <div
              className={styles.page}
              data-slot="room-project"
              data-ground={documentGround}
              hidden={!projectOpen}
            >
              <BackToChat onClose={closeProject} />
              <SketchingShown value={showSketch}>
                <ArtifactPane
                  {...documentPane}
                  {...paneParts}
                  paneRef={paneRef}
                  open={projectOpen}
                />
              </SketchingShown>
            </div>
          ) : null}
          {sheetShown && side !== null ? (
            <div className={styles.page} data-slot="room-space-sheet">
              <BackToChat onClose={closeSheet} />
              <PluginSpace title={side.title} headingRef={headingRef}>
                {spaceScreen}
              </PluginSpace>
            </div>
          ) : null}
          {/* One box over the conversation and whatever covers it, so opening or closing a view
              never moves it or starts it over. */}
          <div ref={dockRef} className={styles.dock} data-slot="room-dock">
            <RoomDockView
              dock={projectShown && sketches > 0 ? sketchingDock(dock) : dock}
              ports={ports}
              waiting={card}
              cardHidden={decidesPage}
              chat={covered ? chat : undefined}
              chatStart={
                covered
                  ? { saysWork: true, onFullScreen: fullScreen }
                  : undefined
              }
              answersShell={shell.answers}
            />
          </div>
        </div>
      </RoomFrame>
      {shell.reply}
    </StageView>
  );
}

/**
 * What waits on the person as the card the prompt box holds. A screen for the page has a card,
 * with Open while the space is not in sight; any other screen is the card, its actions in the box's
 * row as every card's are.
 */
function waitingCard(
  waiting: BoxWaiting | null,
  openSpace: (() => void) | undefined,
  screen: ReactNode,
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
      if (screen !== null) return screen;
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

/**
 * A sketch at work on the page already says work is under way, so the box over it does not say it
 * again; a status with something to press, such as Try again, still shows.
 */
function sketchingDock(dock: RoomDock): RoomDock {
  return dock.kind === "composer" && dock.status?.onAction === undefined
    ? { ...dock, status: null }
    : dock;
}

/** Shuts the view over the conversation like a full-screen modal, in the corner people look for. */
function BackToChat({ onClose }: { onClose: () => void }) {
  return (
    <UiButton
      type="button"
      size="icon"
      variant="ghost"
      className={styles.close}
      aria-label={wording.conversation.backToChat}
      title={wording.conversation.backToChatHint}
      onClick={onClose}
    >
      <X size={18} aria-hidden="true" />
    </UiButton>
  );
}

const decides = (waiting: BoxWaiting | null) =>
  waiting?.kind === "screen" && waiting.decides;

/** Takes a shell request typed into the composer, so it is answered rather than sent. */
type AnswersShell = (text: string) => boolean;

/** Where the chat sheet starts, before the person moves it. */
type ChatStart = Pick<
  ChatSheetProps,
  "defaultState" | "defaultPull" | "onFullScreen" | "saysWork"
>;

/**
 * What sits under the conversation: the prompt box with its handle and chat sheet, or the
 * banner saying why there is none. Stories draw the dock's states with it.
 */
export function RoomDockView({
  dock,
  waiting,
  cardHidden = false,
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
  /** What waits stays out of sight, its buttons still in the row, where the page shows it. */
  cardHidden?: boolean;
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
      cardHidden={cardHidden}
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
  onSendComments,
  onShowComments,
  onRemoveComments,
  commentsBlocked = null,
  commentsSending = false,
  onStop,
  waiting,
  cardHidden,
  chat,
  chatStart,
  ports: shared,
  answersShell,
}: RoomComposer & {
  waiting: ReactNode;
  cardHidden: boolean;
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
  const commentsReady =
    comments > 0 &&
    onSendComments !== undefined &&
    commentsBlocked === null &&
    !commentsSending;
  const send = () => {
    // With nothing typed, Send is the comments' own send.
    if (!typed && commentsReady) return onSendComments();
    if (files.length === 0 && answersShell?.(text) === true)
      return onTextChange("");
    // A screen in the box takes the words with what is picked in it, so the pick is not lost.
    const words = text.trim();
    if (files.length === 0 && words !== "" && ports.take?.(words) === true)
      return onTextChange("");
    // Words typed beside the comments go out with them, as one message.
    if (files.length === 0 && commentsReady) return onSendComments(words);
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
            canSubmit={!busy && (typed || sendLabel !== null || commentsReady)}
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
              // The count opens the page the comments are on; the cross removes them all.
              <span className={styles.commentsToken} data-slot="comments-token">
                <button
                  type="button"
                  className={styles.commentsShow}
                  aria-label={wording.promptBox.showComments(comments)}
                  title={wording.promptBox.showComments(comments)}
                  aria-busy={commentsSending || undefined}
                  onClick={onShowComments}
                >
                  <MessageSquare size={12} aria-hidden="true" />
                  {wording.promptBox.comments(comments)}
                </button>
                <button
                  type="button"
                  className={styles.commentsRemove}
                  aria-label={wording.promptBox.removeComments(comments)}
                  title={wording.promptBox.removeComments(comments)}
                  disabled={commentsSending}
                  onClick={onRemoveComments}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ) : null}
            <PromptInputTextarea
              ref={inputRef}
              // Enter on an empty box goes to what waits in it, as Continue's tooltip says: a pick
              // goes forward as Continue would take it.
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.nativeEvent.isComposing ||
                  typed ||
                  busy
                )
                  return;
                if (ports.take?.("") === true) event.preventDefault();
              }}
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
                  : // Words typed beside comments go with them, so the box asks for more, not instead.
                    comments > 0
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
                      they stand in for Send until the person types, or until comments wait that
                      Send names as its own; Send stands while it is empty. Kept meanwhile, only
                      hidden, so its buttons keep their place and focus. */}
                  <div
                    ref={ports.setActionsAt}
                    data-slot="composer-actions"
                    hidden={typed || (commentsReady && sendLabel !== null)}
                  />
                  {/* Where Send carries something of its own, it says so on itself, a pill
                      with its words before the arrow. */}
                  <PromptInputSubmit
                    {...(stopping ? { onStop } : {})}
                    aria-label={sendLabel ?? undefined}
                    data-label={sendLabel ?? undefined}
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
      // With nothing but the card to show, the box is its typing row alone.
      bare={
        cardHidden &&
        restarts === null &&
        (comments === 0 || commentsBlocked === null)
      }
      panel={
        restarts !== null ||
        waiting !== undefined ||
        (comments > 0 && commentsBlocked !== null) ? (
          <>
            <div className={styles.card} hidden={cardHidden}>
              <InBox ports={ports} as={waiting === undefined ? null : "card"}>
                {waiting}
              </InBox>
            </div>
            {/* Nearest the words it is about, after anything else that waits. */}
            {restarts === null ? null : (
              <p className={styles.restarts} role="status">
                <TriangleAlert size={14} aria-hidden="true" />
                {restarts}
              </p>
            )}
            {comments === 0 || commentsBlocked === null ? null : (
              <p
                className={styles.restarts}
                data-slot="comments-blocked"
                role="status"
              >
                <MessageSquare size={14} aria-hidden="true" />
                {commentsBlocked}
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
