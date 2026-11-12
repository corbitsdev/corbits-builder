/**
 * The project room as it looks: the conversation with the coordinator, the dock beneath it (the
 * composer, or a banner saying why there is none), and the reading pane beside it once there is
 * something to read.
 */
import { useRef, type ReactNode, type RefObject } from "react";
import { Paperclip, Sparkles } from "lucide-react";
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
import { StageView } from "./stage-view.tsx";
import { RoomThread, type RoomThreadContent } from "./transcript.tsx";
import styles from "./index.module.css";

/** The parts of the room that read the hub for themselves, which the page fills. */
export type RoomSlots = {
  /** The line above the conversation saying where the project stands and the person's next step. */
  nextStep: ReactNode;
  /** The reading pane's own such parts. */
  paneParts: ArtifactPaneSlots;
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
    /** Nothing is filed yet, so the conversation takes the whole width and there is no pane. */
    chatFirst: boolean;
    /** How many documents and design concepts the pane holds, for the narrow screen's switch. */
    artifactCount: number;
    /** Which of the two a narrow screen shows. */
    narrowPane: "conversation" | "artifacts";
    onNarrowPaneChange: (pane: "conversation" | "artifacts") => void;
  };
  conversation: {
    thread: RoomThreadContent;
    /** What stands in the thread's place: an archived project's note, or a new project's welcome. */
    empty: "archived" | "new" | null;
  };
  dock: RoomDock;
  documentPane: ArtifactPaneContent;
  /** The reading pane itself, which the room moves focus to. */
  paneRef: RefObject<HTMLElement | null>;
};

export type RoomViewProps = RoomContent & RoomSlots;

export function RoomView({
  title,
  layout,
  conversation,
  dock,
  documentPane,
  paneRef,
  nextStep,
  paneParts,
}: RoomViewProps) {
  const { chatFirst, narrowPane, onNarrowPaneChange } = layout;
  const shell = useShellReply(paneRef);
  return (
    <StageView aria-label={`Conversation for ${title}`}>
      <div
        className={styles.room}
        data-mobile-pane={chatFirst ? "conversation" : narrowPane}
      >
        {chatFirst ? null : (
          <nav className={styles.mobileSwitch} aria-label="Workspace panes">
            <button
              type="button"
              aria-pressed={narrowPane === "conversation"}
              onClick={() => onNarrowPaneChange("conversation")}
            >
              Conversation
            </button>
            <button
              type="button"
              aria-pressed={narrowPane === "artifacts"}
              onClick={() => onNarrowPaneChange("artifacts")}
            >
              Artifacts ({layout.artifactCount})
            </button>
          </nav>
        )}
        <div
          className={styles.panes}
          data-chat-first={chatFirst ? "" : undefined}
        >
          <section
            className={styles.conversationPane}
            aria-label="Project conversation"
          >
            <div className={styles.conversation}>
              {nextStep}
              <RoomThread {...conversation.thread}>
                <EmptyConversation empty={conversation.empty} />
              </RoomThread>
              <Dock dock={dock} answersShell={shell.answers} />
            </div>
          </section>
          {chatFirst ? null : (
            <ArtifactPane {...documentPane} {...paneParts} paneRef={paneRef} />
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
