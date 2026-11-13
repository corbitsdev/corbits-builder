/**
 * The project room as it looks: the conversation with the coordinator across the page, the dock
 * beneath it (the composer, or a banner saying why there is none), and the project view that opens
 * over it from a card or the project control and closes back to the conversation.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { FolderOpen, Paperclip, Sparkles } from "lucide-react";
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
import type { PlanView } from "@corbits-builder/schemas/project";
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
import { pastedFiles } from "./pasted-files.ts";
import { PlanPanel, planProgress, usePlanCollapsed } from "./plan-panel.tsx";
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
};

/** The box the person writes to the coordinator in. */
export type RoomComposer = {
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  /** The box itself, which the room puts the cursor in. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The coordinator is mid-turn or a message is on its way, so a ring sweeps the box. */
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
  /** The specialist already building from a document this message changes; the send waits on a second yes. */
  caution: string | null;
  onSendAnyway: () => void;
  onCancelCaution: () => void;
  /** The answers the coordinator's last message offers, each sent as it is. */
  suggestedReplies: readonly string[];
  onReply: (reply: string) => void;
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
  /** The project's plan, top-level steps first; empty while it has none, and then nothing shows it. */
  plan: PlanView["steps"];
  /** The person declines an optional plan step, or brings back one they declined. */
  onDeclineStep: (stepId: string, declined: boolean) => Promise<void>;
  /** The person gives the go-ahead on a step they asked to be consulted on. */
  onGoAheadStep: (stepId: string) => Promise<void>;
  /** The person turns "ask me first" on or off for a step that has not started. */
  onAskFirstStep: (stepId: string, askFirst: boolean) => Promise<void>;
  documentPane: ArtifactPaneContent;
  /** The project view's pane, which takes focus as it opens. */
  paneRef: RefObject<HTMLElement | null>;
};

/** Below this width of the room, the plan is a drawer over the conversation. */
const NARROW_ROOM_PX = 900;

export type RoomViewProps = RoomContent & RoomSlots;

export function RoomView({
  title,
  layout,
  conversation,
  dock,
  plan,
  onDeclineStep,
  onGoAheadStep,
  onAskFirstStep,
  documentPane,
  paneRef,
  nextStep,
  paneParts,
  page,
}: RoomViewProps) {
  const { projectReady, projectOpen, onProjectOpenChange, pageOpen } = layout;
  const conversationRef = useRef<HTMLElement>(null);
  const shell = useShellReply(conversationRef);
  const closeProject = () => onProjectOpenChange(false);
  // The plan sits beside the conversation; in a room too narrow for that it is a drawer, shut
  // until the person opens it.
  const roomRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [planFolded, setPlanFolded] = usePlanCollapsed();
  useEffect(() => {
    const room = roomRef.current;
    if (room === null) return;
    const observer = new ResizeObserver(() =>
      setNarrow(room.clientWidth < NARROW_ROOM_PX),
    );
    observer.observe(room);
    return () => observer.disconnect();
  }, []);
  const planShown = plan.length > 0 && (narrow ? drawerOpen : !planFolded);
  const setPlanShown = (shown: boolean) =>
    narrow ? setDrawerOpen(shown) : setPlanFolded(!shown);
  const progress = planProgress(plan);
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
      if (event.key === "Escape" && !event.defaultPrevented) closeProject();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [projectOpen, pageOpen]);
  // The prompt box stays in reach under whatever covers the conversation.
  const dockInProject = projectOpen && !pageOpen;
  const dockInConversation = !projectOpen && !pageOpen;
  const roomDock = <Dock dock={dock} answersShell={shell.answers} />;
  return (
    <StageView aria-label={`Conversation for ${title}`}>
      <div ref={roomRef} className={styles.room}>
        <section
          ref={conversationRef}
          className={styles.conversationPane}
          aria-label="Project conversation"
        >
          <div className={styles.conversation}>
            <div className={styles.top}>
              {nextStep}
              {projectReady || progress !== null ? (
                <div className={styles.controls}>
                  {progress === null ? null : (
                    <UiButton
                      type="button"
                      size="sm"
                      variant={planShown ? "secondary" : "ghost"}
                      className={styles.control}
                      aria-pressed={planShown}
                      aria-label={wording.conversation.plan.progressLabel(
                        progress.done,
                        progress.total,
                        progress.alert,
                      )}
                      title={
                        planShown
                          ? wording.conversation.plan.hide
                          : wording.conversation.plan.show
                      }
                      onClick={() => setPlanShown(!planShown)}
                    >
                      <span>{wording.conversation.plan.title}</span>
                      <span className={styles.meter} aria-hidden="true">
                        {progress.marks.map(({ id, mark }) => (
                          <span key={id} data-mark={mark} />
                        ))}
                      </span>
                      <span className={styles.count}>
                        {wording.conversation.plan.progress(
                          progress.done,
                          progress.total,
                        )}
                      </span>
                      {progress.alert === null ? null : (
                        <span
                          className={styles.alert}
                          data-mark={progress.alert}
                        />
                      )}
                    </UiButton>
                  )}
                  {projectReady ? (
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
                  ) : null}
                </div>
              ) : null}
            </div>
            <RoomThread {...conversation.thread}>
              <EmptyConversation empty={conversation.empty} />
            </RoomThread>
            {dockInConversation ? roomDock : null}
          </div>
        </section>
        {planShown ? (
          <PlanPanel
            steps={plan}
            drawer={narrow}
            onHide={() => setPlanShown(false)}
            onDecline={onDeclineStep}
            onGoAhead={onGoAheadStep}
            onAskFirst={onAskFirstStep}
          />
        ) : null}
        {projectReady ? (
          // Kept while closed, so its tabs, previews and drafts keep their place.
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
          <div className={styles.page} data-slot="room-page" hidden={!pageOpen}>
            <div className={styles.pageScreen}>{page}</div>
            {pageOpen ? roomDock : null}
          </div>
        )}
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

function Dock({
  dock,
  answersShell,
}: {
  dock: RoomDock;
  answersShell: AnswersShell;
}) {
  if (dock.kind === "archived")
    return (
      <Banner title={wording.archivedProject.title}>
        <p>{wording.archivedProject.lead}</p>
        {dock.fault === null ? null : <Fault>{dock.fault}</Fault>}
        <BannerAction>
          <UiButton
            type="button"
            size="sm"
            disabled={dock.restoring}
            onClick={dock.onRestore}
          >
            {dock.restoring
              ? wording.archivedProject.restoring
              : wording.archivedProject.restore}
          </UiButton>
        </BannerAction>
      </Banner>
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
  return <RoomComposerView {...dock} answersShell={answersShell} />;
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
  caution,
  onSendAnyway,
  onCancelCaution,
  suggestedReplies,
  onReply,
  answersShell,
}: RoomComposer & { answersShell: AnswersShell }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { files } = attachments;
  const accept = needsProvider ? null : attachments.accept;
  // Files can be attached while the hub offers kinds it reads, the provider is set and nothing is
  // mid-send; the drop zone, the paperclip and a paste all follow this.
  const attaching = accept !== null && !busy;
  const send = () => {
    if (files.length === 0 && answersShell(text)) return onTextChange("");
    onSend();
  };
  return (
    <Composer
      working={working}
      notes={
        <>
          {attachments.fault === null ? null : (
            <Fault>{attachments.fault}</Fault>
          )}
          {sendFault === null ? null : <Fault>{sendFault}</Fault>}
          {caution === null ? null : (
            <div className={styles.caution} role="alert">
              <p>{wording.earlierDocument.warning(caution)}</p>
              <div className={styles.cautionActions}>
                <UiButton type="button" size="sm" onClick={onSendAnyway}>
                  {wording.earlierDocument.sendAnyway}
                </UiButton>
                <UiButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onCancelCaution}
                >
                  {wording.action.cancel}
                </UiButton>
              </div>
            </div>
          )}
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
      <AttachmentDropZone
        onFiles={attachments.onAdd}
        disabled={!attaching}
        label={wording.conversation.dropFiles}
      >
        <Dictated value={text} onValueChange={onTextChange} disabled={busy}>
          {(mic) => (
            <PromptInput
              value={text}
              onValueChange={onTextChange}
              onSubmit={send}
              canSubmit={text.trim() !== "" || files.length > 0}
              status={busy ? "submitted" : "ready"}
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
                    : placeholder
                }
              />
              <PromptInputToolbar>
                {needsProvider ? null : mic}
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
                      aria-label={wording.attach.add}
                      title={wording.attach.add}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={16} aria-hidden="true" />
                    </PromptInputButton>
                  </>
                )}
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
                  <PromptInputSubmit className="ms-auto" />
                )}
              </PromptInputToolbar>
            </PromptInput>
          )}
        </Dictated>
      </AttachmentDropZone>
    </Composer>
  );
}
