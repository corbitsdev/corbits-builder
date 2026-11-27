/**
 * What the prompt box and the status pill above it show, and the plugin space beside the room's
 * main area. It reads what the room knows and the hub's live app, runs waiting.ts for what waits on
 * the person and room-status.ts for what one line says is happening, and hands the box, the pill
 * and the space their props. The room's model only puts it together with the rest.
 */
import { useCallback, useMemo, useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { FailedRun, LiveApp } from "@corbits-builder/schemas/artifact";
import {
  showsScreen,
  type ConversationQuestion,
  type QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import type { PlanView } from "@corbits-builder/schemas/plan";
import type { ShownScreen } from "@corbits-builder/schemas/project";
import { goAheadPlanStep } from "../../api/artifacts.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";
import { useUnsent } from "../../unsent.ts";
import {
  afterSent,
  commentedDocument,
  commentsMessage,
  commentsSend,
  deleteDraft,
  draftsKey,
  readDrafts,
  restoreDrafts,
  saveDraft,
  storedDrafts,
  type CommentDraft,
} from "./comments.ts";
import type { ProjectComments } from "./document-page.model.ts";
import {
  dispatchStatus,
  type Dispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { humanFault } from "./human-fault.ts";
import type { SpaceScreenProps } from "./plugin-screens.tsx";
import { screenWords } from "./roles.ts";
import { roomStatus, type RoomStatusFacts } from "./room-status.ts";
import type { BoxWaiting } from "./room.view.tsx";
import { SLOT, type ScreenLookup } from "./screens.ts";
import type {
  HostSupplies,
  ListedHostProps,
  ProjectValuesStore,
} from "./screen-question.tsx";
import type { SeenVersions } from "./seen-versions.ts";
import type { OpenApproval } from "./settled-approvals.ts";
import type { StatusPillContent } from "./status-pill.tsx";
import type { TypedYes } from "./typed-yes.tsx";
import { workPhrase } from "./work-unit.ts";
import {
  boxCard,
  sendWarning,
  spaceScreens,
  waitingOn,
  type WaitingScreenSource,
} from "./waiting.ts";
import type { RoomSession } from "./room-session.ts";
import { LIVE_TAB } from "./tab-follow.ts";

/** What the room already knows and does, which the box, the pill and the space are made from. */
export type PromptBoxRoom = {
  /** The coordinator's open question, if any. */
  openQuestion: ConversationQuestion | undefined;
  onAnswer: (signalName: string, answer: QuestionAnswer) => Promise<boolean>;
  /** A message or an answer is on its way. */
  sending: boolean;
  /** The approvals no one has decided yet; undefined until read. */
  approvals: readonly OpenApproval[] | undefined;
  approvalBusy: boolean;
  approvalError: string | null;
  typedYes: { held: TypedYes; onUndo: () => void } | null;
  /** Resolves to the fault the person sees, or null once the decision stands. */
  onDecide: (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }) => Promise<string | null>;
  /** Takes the person to the box to say what should change instead. */
  onRequestChanges: () => void;
  plan: PlanView["steps"];
  /** The screens plugins show of their own accord. */
  screens: readonly ShownScreen[];
  screenOf: ScreenLookup;
  supplies: HostSupplies;
  projectValues: ProjectValuesStore;
  /** Runs a plugin's action from its own screen; resolves to why it failed, if it did. */
  act: ListedHostProps["act"];
  /** What sending the typed words would restart; null while nothing. */
  restarts: string | null;
  /** The coordinator is mid-turn. */
  thinking: boolean;
  /** Every hand-off in view, with where the room says it stands. */
  dispatches: readonly Dispatch[];
  dispatchRoom: DispatchRoom;
  failed: readonly FailedRun[];
  /** When the person last sent a message from here, in ms. */
  lastSentAt: number | null;
  /** The documents the project view lists, and the versions this viewer opened. */
  documents: readonly ProjectArtifact[];
  seen: SeenVersions;
  /** The project has an app to run. */
  hasApp: boolean;
};

export type PromptBox = {
  /** The one card the box holds. */
  waiting: BoxWaiting | null;
  /**
   * The first plugin screen waiting: one for the page opens in the plugin space, any other in the
   * box's card once it is the box's turn; null while none is shown. It names the kind of filed
   * artifact it shows more of, when its plugin says.
   */
  space: {
    key: string;
    title: string;
    place: "page" | "box";
    shows: string | null;
  } | null;
  spaceScreen: SpaceScreenProps | null;
  /** The pill's line and button. */
  status: StatusPillContent | null;
  /** The facts the pill's line comes from. The box's placeholder reads them too. */
  facts: RoomStatusFacts;
  /** The line above the words about what sending them restarts. */
  restarts: string | null;
  /** A specialist is at work, so Stop stands where Send is while the box is empty. */
  working: boolean;
  /**
   * The coordinator waits on a screen asking the person to accept something, such as approving a
   * document; words typed instead ask for changes.
   */
  decides: boolean;
  onStop: () => void;
};

const at = (iso: string | undefined) =>
  iso === undefined ? Number.NaN : Date.parse(iso);

export function usePromptBox(
  session: RoomSession,
  room: PromptBoxRoom,
): PromptBox {
  const { projectId } = session;
  const { openQuestion, screenOf } = room;
  const [goingAhead, setGoingAhead] = useState<string | null>(null);
  // The app the hub keeps running while the project is open, as its presence read last saw it.
  const app = useQuery<LiveApp>({
    queryKey: keys.liveApp.of(projectId),
    queryFn: skipToken,
    enabled: room.hasApp,
  }).data;

  // A screen is named by its plugin's own words for it, else by its action.
  const titleOf = (
    plugin: string,
    action: string,
    input: unknown,
  ): WaitingScreenSource => ({
    plugin,
    action,
    title: screenWords(plugin, action)?.label(input) ?? action,
  });
  const questionScreen =
    openQuestion !== undefined && showsScreen(openQuestion)
      ? openQuestion.asked
      : undefined;
  const listed = session.archived
    ? []
    : room.screens.filter((screen) => screenOf(screen)?.listed !== undefined);
  const waiting = waitingOn({
    question:
      openQuestion === undefined
        ? null
        : {
            signalName: openQuestion.signalName,
            screen:
              questionScreen === undefined
                ? null
                : titleOf(
                    questionScreen.plugin,
                    questionScreen.action,
                    questionScreen.input,
                  ),
          },
    approvals: room.approvals ?? [],
    plan: room.plan,
    screens: listed.map((screen) => titleOf(screen.plugin, screen.action, {})),
    restarts: room.restarts,
  });

  const goAhead = async (stepId: string) => {
    setGoingAhead(stepId);
    try {
      await goAheadPlanStep(projectId, stepId);
      session.reload();
    } catch (cause) {
      toast.error(humanFault(cause, wording.conversation.plan.notChanged));
    } finally {
      setGoingAhead(null);
    }
  };

  const card = boxCard(waiting);
  const decides =
    card?.kind === "screen" &&
    card.from === "question" &&
    screenWords(card.plugin, card.action)?.decides === true;
  function waitingInBox(): BoxWaiting | null {
    if (card === null) return null;
    switch (card.kind) {
      case "question":
        return openQuestion === undefined || showsScreen(openQuestion)
          ? null
          : {
              kind: "question",
              question: openQuestion,
              disabled: room.sending || session.archived,
              onAnswer: (answer) =>
                room.onAnswer(openQuestion.signalName, answer),
            };
      case "approval": {
        const approval = room.approvals?.find(
          (item) => item.approvalId === card.approvalId,
        );
        if (approval === undefined) return null;
        return {
          kind: "approval",
          approval,
          disabled: room.approvalBusy || session.archived,
          error: room.approvalError,
          typedYes: room.typedYes,
          onDecide: (choice) => {
            void room.onDecide({ approvalId: approval.approvalId, choice });
            // Not yet leaves the person in the box to say what to do instead.
            if (choice === "no") room.onRequestChanges();
          },
        };
      }
      case "step":
        return {
          kind: "step",
          title: card.title,
          busy: goingAhead === card.stepId,
          onGoAhead: () => void goAhead(card.stepId),
        };
      case "screen":
        return {
          kind: "screen",
          title: card.title,
          decides,
        };
      default:
        return card satisfies never;
    }
  }
  const boxWaiting = waitingInBox();

  const first = spaceScreens(waiting)[0];
  const shown =
    first === undefined || first.from === "question"
      ? undefined
      : listed.find(
          (screen) =>
            screen.plugin === first.plugin && screen.action === first.action,
        );
  // A plugin draws a screen for the page or for the conversation. One for the page opens beside the
  // room; any other is answered in the box, so it waits there until it is the box's card.
  const forPage =
    first?.from === "question"
      ? questionScreen !== undefined && screenOf(questionScreen)?.page === true
      : shown !== undefined && SLOT[shown.render] === "page";
  const place = forPage ? "page" : "box";
  const held =
    first !== undefined && place === "box" && card?.key !== first.key;
  function screenInSpace(): SpaceScreenProps | null {
    if (first === undefined || held) return null;
    if (first.from === "question") {
      if (openQuestion === undefined || !showsScreen(openQuestion)) return null;
      return {
        kind: "question",
        question: {
          signalName: openQuestion.signalName,
          host: screenOf(openQuestion.asked)?.host,
          input: openQuestion.asked.input,
          projectValues: room.projectValues,
          answer: undefined,
          disabled: room.sending || session.archived,
          onAnswer: (answer) => room.onAnswer(openQuestion.signalName, answer),
          supplies: room.supplies,
        },
      };
    }
    const Listed = shown === undefined ? undefined : screenOf(shown)?.listed;
    if (shown === undefined || Listed === undefined) return null;
    return {
      kind: "plugin",
      name: `${shown.plugin} ${shown.action}`,
      Listed,
      listed: { state: shown.state, act: room.act, host: room.supplies },
    };
  }
  const spaceScreen = screenInSpace();

  // Specialists at work, and those that failed, each by what it does.
  const standings = room.dispatches.map((dispatch) => ({
    dispatch,
    status: dispatchStatus(dispatch, room.dispatchRoom),
  }));
  const working = standings.flatMap(({ dispatch, status }) =>
    dispatch.runId !== undefined &&
    (status.state === "working" || status.state === "starting")
      ? [{ runId: dispatch.runId, doing: workPhrase(dispatch, status) }]
      : [],
  );
  const failed = standings.flatMap(({ dispatch, status }) => {
    if (status.state !== "failed") return [];
    const record = room.failed.find((run) => run.runId === dispatch.runId);
    const endedAt = at(record?.endedAt);
    return Number.isNaN(endedAt)
      ? []
      : [{ doing: workPhrase(dispatch, status), endedAt }];
  });
  const facts: RoomStatusFacts = {
    sending: room.sending,
    thinking: room.thinking,
    working,
    failed,
    lastSentAt: room.lastSentAt,
    plan: room.plan,
    documents: [...room.documents]
      .sort((left, right) => at(left.filedAt) - at(right.filedAt))
      .map((item) => ({
        id: item.kind,
        title: item.title,
        version: item.version,
        seen: room.seen[item.artifactId] === item.version,
      })),
    app: room.hasApp ? (app?.state ?? null) : null,
    asking: card !== null,
    projectOpen: session.projectOpen,
  };
  const line = session.archived ? null : roomStatus(facts);
  const status: StatusPillContent | null =
    line === null
      ? null
      : {
          state: line.state,
          label: line.label,
          ...(line.action === null
            ? {}
            : {
                action: line.action.label,
                onAction: () => {
                  const action = line.action;
                  if (action === null) return;
                  if (action.kind === "openDocument")
                    session.openTab(action.id);
                  else if (action.kind === "openApp") session.openTab(LIVE_TAB);
                  else session.send(action.message);
                },
              }),
        };

  // Stop is for specialists only: the coordinator's own turn cannot be interrupted. Each run stops
  // as its own row's Stop would, so its row reads stopped at once.
  const stop = () => {
    for (const { runId } of working) void room.dispatchRoom.onStop?.(runId);
  };

  return {
    waiting: boxWaiting,
    space:
      first === undefined || held
        ? null
        : {
            key: first.key,
            title: first.title,
            place,
            shows: screenWords(first.plugin, first.action)?.shows ?? null,
          },
    spaceScreen,
    status,
    facts,
    restarts: sendWarning(waiting),
    working: working.length > 0,
    decides,
    onStop: stop,
  };
}

/** What the room knows that the comment drafts and their sending need. */
export type CommentsRoom = {
  /** The coordinator's question is open, so a message would answer it. */
  question: boolean;
  /** An approval is open, so a message would decline it. */
  approval: boolean;
  /** A message or an answer is on its way. */
  sending: boolean;
  /** Re-reads the hub for an open approval just before the comments go. */
  approvalOpenNow: () => Promise<boolean>;
  /**
   * Sends one ordinary message as the person; resolves whether it went. With the person's own
   * words in it, the box is cleared once it went.
   */
  mail: (message: string, clearBox: boolean) => Promise<boolean>;
};

/** The comment token in the prompt box: how many wait, sending, showing and removing them. */
export type BoxComments = {
  count: number;
  /** Why they cannot be sent now, naming what to deal with first; null while they can. */
  blocked: string | null;
  sending: boolean;
  /** Sends them as one message, with any words typed beside them last. */
  onSend: (words?: string) => void;
  /** Opens the page they are on. */
  onShow: () => void;
  /** Removes them all, with a moment to undo it. */
  onRemove: () => void;
};

/**
 * The person's comment drafts on the project's documents, kept in this tab beside the unsent
 * message, and the box's row that sends them all as one message.
 */
export function useCommentDrafts(
  session: RoomSession,
  room: CommentsRoom,
): {
  comments: ProjectComments | undefined;
  box: BoxComments | null;
} {
  const [stored, setStored] = useUnsent(draftsKey(session.projectId));
  const drafts = useMemo(() => readDrafts(stored), [stored]);
  const [going, setGoing] = useState(false);
  const change = useCallback(
    (next: (drafts: CommentDraft[]) => CommentDraft[]) =>
      setStored((was) => storedDrafts(next(readDrafts(was)))),
    [setStored],
  );
  const send = commentsSend({
    drafts,
    sending: room.sending || going,
    question: room.question,
    approval: room.approval,
  });

  const sendAll = async (words = "") => {
    if (send.state !== "ready") return;
    const outgoing = drafts;
    setGoing(true);
    try {
      // An approval raised since the room last read would take the message as its decline.
      if (await room.approvalOpenNow()) return;
      if (
        await room.mail(commentsMessage(outgoing, words), words.trim() !== "")
      )
        change((now) => afterSent(now, outgoing));
    } finally {
      setGoing(false);
    }
  };

  const removeAll = () => {
    const removed = drafts;
    change(() => []);
    toast(wording.promptBox.commentsRemoved(removed.length), {
      action: {
        label: wording.promptBox.undoRemove,
        onClick: () => change((now) => restoreDrafts(now, removed)),
      },
    });
  };

  if (session.archived) return { comments: undefined, box: null };
  const words = wording.promptBox;
  return {
    comments: {
      drafts,
      onSave: (draft) => change((now) => saveDraft(now, draft)),
      onDelete: (id) => change((now) => deleteDraft(now, id)),
    },
    box:
      send.state === "none"
        ? null
        : {
            count: drafts.length,
            blocked:
              send.state !== "blocked"
                ? null
                : send.by === "question"
                  ? words.commentsAfterQuestion
                  : words.commentsAfterApproval,
            sending: send.state === "sending",
            onSend: (typed) => void sendAll(typed),
            onShow: () => {
              const document = commentedDocument(drafts, session.shown);
              if (document !== undefined) session.openTab(document);
            },
            onRemove: removeAll,
          },
  };
}
