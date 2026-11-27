/**
 * What the foot of the room holds: the composer, or in its place what keeps the person from
 * writing to the coordinator (an archived project, no model to run on, a coordinator not started).
 */
import { wording } from "../../config.ts";
import { composerPlaceholder } from "./composer-placeholder.ts";
import type { BoxComments, PromptBox } from "./prompt-box.model.ts";
import type { RoomComposer, RoomDock } from "./prompt-box.view.tsx";
import type { RoomPhase } from "./room-status.ts";

export type DockRoom = {
  archived: boolean;
  restore: { restoring: boolean; fault: string | null; onRestore: () => void };
  /** Why the coordinator has no model to run on, in the hub's words; null while it has one. */
  modelNeeded: string | null;
  providerMissing: boolean;
  /** Why the coordinator did not start; null when it did or has not tried. */
  startFault: string | null;
  onOpenSettings: () => void;
  onRetryStart: () => void;
  phase: Pick<RoomPhase, "unbound" | "between" | "busy" | "composerWaits">;
  composer: {
    box: Pick<
      RoomComposer,
      "text" | "onTextChange" | "inputRef" | "attachments" | "sendFault"
    >;
    onSend: () => void;
    onEnableAi: () => void;
    suggestedReplies: readonly string[];
    onReply: (reply: string) => void;
    approvalOpen: boolean;
    questionOpen: boolean;
    /** What the open question's screen asks of the prompt box, when it says. */
    screenReply: string | undefined;
    nothingFiled: boolean;
    promptBox: Pick<
      PromptBox,
      "facts" | "working" | "restarts" | "status" | "onStop" | "decides"
    >;
    comments: BoxComments | null;
  };
};

export function roomDock(room: DockRoom): RoomDock {
  const { phase, providerMissing } = room;
  if (room.archived)
    return {
      kind: "archived",
      restoring: room.restore.restoring,
      fault: room.restore.fault,
      onRestore: room.restore.onRestore,
    };
  // A coordinator with no model to run on cannot answer, even one still bound from before.
  if (room.modelNeeded !== null && !providerMissing)
    return {
      kind: "modelNeeded",
      message: room.modelNeeded,
      onOpenSettings: room.onOpenSettings,
      onRetry: room.onRetryStart,
    };
  // The person does not start the coordinator by typing: an unbound room waits for the
  // start that opening it asked for, and a refused start says why and offers it again.
  if (phase.unbound && !providerMissing && !phase.between) {
    if (room.startFault === null) return { kind: "starting" };
    return {
      kind: "startFailed",
      message: room.startFault,
      onRetry: room.onRetryStart,
    };
  }
  const { box, promptBox, comments } = room.composer;
  return {
    kind: "composer",
    ...box,
    onSend: room.composer.onSend,
    placeholder: composerPlaceholder({
      approvalOpen: room.composer.approvalOpen,
      questionsOpen: room.composer.questionOpen,
      screenReply: room.composer.screenReply,
      facts: promptBox.facts,
      nothingFiled: room.composer.nothingFiled,
    }),
    working: promptBox.working,
    busy: phase.busy,
    disabled: phase.composerWaits,
    needsProvider: providerMissing,
    onEnableAi: room.composer.onEnableAi,
    restarts: promptBox.restarts,
    status: promptBox.status,
    onStop: promptBox.onStop,
    suggestedReplies: room.composer.suggestedReplies,
    onReply: room.composer.onReply,
    // Words typed or comments beside a screen asking to approve something ask for changes instead.
    sendLabel:
      promptBox.decides &&
      (box.text.trim() !== "" || (comments?.count ?? 0) > 0)
        ? wording.promptBox.waiting.makeChanges
        : null,
    ...(comments === null
      ? {}
      : {
          comments: comments.count,
          commentsBlocked: comments.blocked,
          commentsSending: comments.sending,
          onSendComments: comments.onSend,
          onShowComments: comments.onShow,
          onRemoveComments: comments.onRemove,
        }),
  };
}
