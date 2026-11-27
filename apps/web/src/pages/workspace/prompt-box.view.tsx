/**
 * The prompt box as it looks: what it holds for the person to deal with, the composer with its
 * chat sheet, or the banner saying why there is no composer.
 */
import { useRef, type ReactNode, type RefObject } from "react";
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
  PromptInput,
  PromptInputButton,
  PromptInputFloat,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@corbits/react-ui";
import type {
  PromptQuestion,
  QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import { Banner, BannerAction, Fault } from "../../components.jsx";
import { Composer } from "../../composer.tsx";
import { Dictated } from "../../dictation.jsx";
import { InBox, useBoxPorts, type BoxPorts } from "./box-ports.tsx";
import { ScreenCard, StepCard } from "./box-cards.tsx";
import { submit } from "./box-submit.ts";
import { DocumentDecision, PackageDecision } from "./document-decision.tsx";
import { QuestionsCard } from "./questions-card.tsx";
import type { DocumentApproval } from "./collaboration.ts";
import { TypedYesCountdown, type TypedYes } from "./typed-yes.tsx";
import { pastedFiles } from "./pasted-files.ts";
import { ChatSheet, type ChatSheetProps } from "./chat-sheet.tsx";
import type { StatusPillContent } from "./status-pill.tsx";
import styles from "./prompt-box.module.css";

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

/**
 * What waits on the person as the card the prompt box holds. A screen for the page has a card,
 * with Open while the space is not in sight; any other screen is the card, its actions in the box's
 * row as every card's are.
 */
export function waitingCard(
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

export const decides = (
  waiting: BoxWaiting | null,
): waiting is Extract<BoxWaiting, { kind: "screen" }> =>
  waiting?.kind === "screen" && waiting.decides;

/** Takes a shell request typed into the composer, so it is answered rather than sent. */
type AnswersShell = (text: string) => boolean;

/** Where the chat sheet starts, before the person moves it. */
type ChatStart = Pick<
  ChatSheetProps,
  "defaultState" | "defaultPull" | "onFullScreen" | "saysWork" | "onUpChange"
>;

/**
 * What sits under the conversation: the prompt box with its handle and chat sheet, or the
 * banner saying why there is none. Stories draw the dock's states with it.
 */
export function RoomDockView({
  dock,
  waiting,
  cardHidden = false,
  cardAsk = null,
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
  /** The title of a hidden card, shown above the words so Approve says what it agrees to. */
  cardAsk?: string | null;
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
      cardAsk={cardAsk}
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
  cardAsk,
  chat,
  chatStart,
  ports: shared,
  answersShell,
}: RoomComposer & {
  waiting: ReactNode;
  cardHidden: boolean;
  cardAsk: string | null;
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
  // Send names what a screen in the box sends, or else gets the room's label.
  const label = ports.offer?.label ?? sendLabel;
  // A screen in the box takes the words along with its pick, so the pick isn't lost. When the
  // screen sends them later, the words stay in the box until they've gone.
  const toScreen = (words: string) => {
    const took = ports.offer?.take(words) ?? false;
    if (took === true) onTextChange("");
    else if (took !== false)
      void took.then((went) => {
        if (went) onTextChange("");
      });
    return took !== false;
  };
  const send = () => {
    const sent = submit(text, {
      files: files.length > 0,
      comments: commentsReady ? onSendComments : null,
      shell: answersShell,
      screen:
        ports.offer === undefined
          ? undefined
          : { take: toScreen, label: ports.offer.label },
      message: onSend,
    });
    if (sent === "shell") onTextChange("");
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
            canSubmit={!busy && (typed || label !== null || commentsReady)}
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
                if (toScreen("")) event.preventDefault();
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
                    hidden={typed || (commentsReady && label !== null)}
                  />
                  {/* Where Send carries something of its own, it says so on itself, a pill
                      with its words before the arrow. */}
                  <PromptInputSubmit
                    {...(stopping ? { onStop } : {})}
                    aria-label={label ?? undefined}
                    data-label={label ?? undefined}
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
        cardAsk === null &&
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
            {cardHidden && cardAsk !== null ? (
              <p className={styles.cardAsk} data-slot="card-ask">
                {cardAsk}
              </p>
            ) : null}
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
