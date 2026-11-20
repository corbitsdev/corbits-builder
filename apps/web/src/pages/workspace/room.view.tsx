/**
 * The project room as it looks: the conversation with the coordinator across the page, the dock
 * beneath it (the composer, or a banner saying why there is none), and the project view that opens
 * over it from a card or the project control and closes back to the conversation.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
  /** The line above the conversation saying where the project stands and the person's next step. */
  nextStep: ReactNode;
  /** The reading pane's own such parts. */
  paneParts: ArtifactPaneSlots;
  /** The coordinator's open question drawn over the whole room; null while there is none. */
  page: ReactNode;
  /** Plugin screens meant for the chat, under the conversation. */
  chatScreens: ReactNode;
  /**
   * The conversation for the chat sheet that pulls up around the prompt box over the project view
   * or a page. The room's own conversation already shows the thread, so its box has no sheet.
   * Absent, no box has a handle.
   */
  chat?: ReactNode;
};

/** The box the person writes to the coordinator in. */
export type RoomComposer = {
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  /** The box itself, which the room puts the cursor in. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The coordinator is mid-turn, so Stop stands where Send is while the box is empty. */
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
  /** Stops the work in progress; Stop stands in for Send while the box is empty. */
  onStop?: () => void;
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
    onProjectOpenChange: (open: boolean) => void;
    /** The page slot covers the room, with the prompt box beneath it; closed, it waits hidden. */
    pageOpen: boolean;
  };
  conversation: {
    thread: RoomThreadContent;
    /** What stands in the thread's place: an archived project's note, or a new project's welcome. */
    empty: "archived" | "new" | null;
  };
  dock: RoomDock;
  /** The project's sidebar: its plan, its files, its app and the ways out of the room. */
  sidebar: Omit<ProjectSidebarViewProps, "drawer">;
  documentPane: ArtifactPaneContent;
  /** Where each plugin tab that says so stands, beside the plan, each opening its tab. */
  tabStatus: readonly TabStatus[];
  /** The project view's pane, which takes focus as it opens. */
  paneRef: RefObject<HTMLElement | null>;
};

export type TabStatus = ScreenStatus & { tab: string; onOpen: () => void };

/** Below this width of the room, the sidebar is a drawer over the page. */
const NARROW_ROOM_PX = 900;

export type RoomViewProps = RoomContent & RoomSlots;

export function RoomView({
  title,
  layout,
  conversation,
  dock,
  sidebar,
  documentPane,
  tabStatus,
  paneRef,
  nextStep,
  paneParts,
  page,
  chatScreens,
  chat,
}: RoomViewProps) {
  const { projectReady, projectOpen, onProjectOpenChange, pageOpen } = layout;
  const conversationRef = useRef<HTMLElement>(null);
  const shell = useShellReply(conversationRef);
  const closeProject = () => onProjectOpenChange(false);
  // The sidebar sits beside the page; in a room too narrow for that it is a drawer, shut until the
  // person opens it, and shut again once they pick something in it.
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
  const leaveDrawer =
    <Args extends unknown[]>(go: (...args: Args) => void) =>
    (...args: Args) => {
      setDrawerOpen(false);
      go(...args);
    };
  // Focus goes into the project view as it opens and back to what opened it as it closes.
  useEffect(() => {
    if (!projectOpen) return;
    const opener = document.activeElement;
    paneRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [projectOpen]);
  // A menu inside the view closes on Escape first, and marks the key as used; a screen placed on
  // the page sits over the view, so the key is not the view's while it is open.
  useEffect(() => {
    if (!projectOpen || pageOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
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
  }, [projectOpen, pageOpen]);
  // The prompt box stays in reach under whatever covers the conversation.
  const dockInProject = projectOpen && !pageOpen;
  const dockInConversation = !projectOpen && !pageOpen;
  // A screen over the page reaches the box beneath it: its forward action, placeholder and Send.
  const ports = useBoxPorts();
  const conversationDock = (
    <RoomDockView dock={dock} ports={ports} answersShell={shell.answers} />
  );
  const roomDock = (
    <RoomDockView
      dock={dock}
      ports={ports}
      chat={chat}
      answersShell={shell.answers}
    />
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
          onOpenFile={leaveDrawer(sidebar.onOpenFile)}
          onOpenApp={leaveDrawer(sidebar.onOpenApp)}
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
                {nextStep}
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
                      onClick={() => onProjectOpenChange(true)}
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
              {chatScreens}
              {dockInConversation ? conversationDock : null}
            </div>
          </section>
          {projectReady ? (
            // Kept while closed, so its panes, previews and drafts keep their place.
            <div
              className={styles.page}
              data-slot="room-project"
              hidden={!projectOpen}
            >
              <ArtifactPane
                {...documentPane}
                {...paneParts}
                paneRef={paneRef}
                open={projectOpen}
                onClose={closeProject}
              />
              {dockInProject ? roomDock : null}
            </div>
          ) : null}
          {page === null ? null : (
            // Kept while closed, so the screen's draft and the page it shows wait for the person.
            <div
              className={styles.page}
              data-slot="room-page"
              hidden={!pageOpen}
            >
              <div className={styles.pageScreen}>
                <InBox ports={ports} as={pageOpen ? "page" : null}>
                  {page}
                </InBox>
              </div>
              {pageOpen ? roomDock : null}
            </div>
          )}
        </div>
      </div>
      {shell.reply}
    </StageView>
  );
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
  "defaultState" | "defaultPull" | "returnTo"
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
      <Banner tone="error" role="alert" title={dock.message}>
        <BannerAction>
          <UiButton type="button" size="sm" onClick={dock.onOpenSettings}>
            {wording.action.openSettings}
          </UiButton>
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
    );
  if (dock.kind === "starting")
    return <Banner title={wording.conversation.startingCoordinator} />;
  if (dock.kind === "startFailed")
    return (
      <Banner tone="error" role="alert" title={dock.message}>
        <BannerAction>
          <UiButton type="button" size="sm" onClick={dock.onRetry}>
            {wording.action.retry}
          </UiButton>
        </BannerAction>
      </Banner>
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
      // loses the cursor) when work starts and the pill appears.
      around={(inner) => (
        <ChatSheet {...chatStart} status={status} box={inner}>
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
