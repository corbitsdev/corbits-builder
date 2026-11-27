import type { AnswerOutcome } from "./question-outcome.tsx";
/**
 * What the project room does once it is ready.
 *
 * One conversation with the coordinator, and the project view beside it. `useRoom` works on the
 * loaded snapshot `useRoomGate` hands over: it holds which project view tab is open, calls the
 * room's parts in turn, each passing on what the next needs, and puts their results together as
 * the view's props. The parts run their effects in the order they are called, so the order below
 * is the order the room's reads, streams and timers start in.
 */
import { wording } from "../../config.ts";
import { useMemo, useRef, useState } from "react";
import { useRolesAtWork } from "./project-activity.ts";
import { dispatchLive } from "./dispatch.ts";
import { earlierDocumentRole, restartedWork } from "./earlier-document.ts";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import type { SpaceScreenProps } from "./plugin-screens.tsx";
import { useCommentDrafts, usePromptBox } from "./prompt-box.model.ts";
import type { ReadyRoomProps } from "./room-gate.model.ts";
import { useComposer } from "./composer.model.ts";
import { readArtifact } from "../../api/artifacts.ts";
import { restoreProject } from "../../api/projects.ts";
import {
  showsScreen,
  type QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { useQuestions } from "./questions.model.ts";
import { useDecisions } from "./decisions.model.ts";
import { useDelivery } from "./delivery.model.ts";
import { useRunCards } from "./run-cards.model.ts";
import { usePaneDocuments } from "./pane-documents.model.ts";
import { useScreenSupplies } from "./screen-supplies.model.ts";
import { useAppPreview } from "./app-preview.model.ts";
import { threadUpdates } from "./specialist-updates.ts";
import { openApprovalOf } from "./collaboration.ts";
import { chosenApproach } from "./approach-choice.ts";
import {
  useBindPoll,
  useReloadOnHold,
  useRoomReload,
  useSettleReloads,
} from "./room-reload.model.ts";
import { documentTab } from "./pane-documents.ts";
import { formatPassageQuote, type PassageQuote } from "./passage-quote.ts";
import { humanFaultWithCode } from "../../human-fault.ts";
import { suggestedReplies } from "./suggested-replies.ts";
import { sentItemId, withLiveTurn } from "./visible-chat.ts";
import { workUnitStanding } from "./work-unit-step.model.ts";
import { usePreference } from "../../queries/preferences.ts";
import { type EnableAiDialogProps } from "../model-setup.model.ts";
import type { RoomContent } from "./room.view.tsx";
import { roomDock } from "./room-dock.ts";
import { lastSentAt, roomPhase } from "./room-status.ts";
import { useProjectSidebar } from "./project-sidebar.model.ts";
import type { ProjectMenuHost } from "../project-menu.model.ts";
import type { RoomSession } from "./room-session.ts";
import { useLiveTurn } from "./live-turn.model.ts";
import { screenWords } from "./roles.ts";
import { inTab } from "./screens.ts";

/** The room with its first read in hand: everything here works on a loaded snapshot. */
export function useRoom({
  projectId,
  projectTitle,
  onChanged,
  menuProject,
  onProjectError,
  onOpenSettings,
  onNewProject,
  openingMessage,
  status,
  runTenantId,
  snapshot,
  start,
  refetchProject,
}: ReadyRoomProps): {
  view: RoomContent;
  /** The project's own menu, opened from its name in the sidebar; null until the list has it. */
  projectMenu: ProjectMenuHost | null;
  enableAi: EnableAiDialogProps;
  /** The app the build plan builds, once one is filed. */
  liveApp: { projectId: string; builder: InFlightRun | undefined } | null;
  /** The screen the plugin space shows; null while none waits. */
  spaceScreen: SpaceScreenProps | null;
  questionOutcomes: ReadonlyMap<string, AnswerOutcome>;
} {
  const archived = status === "archived";
  const startFault = start.fault;
  const modelNeeded = start.modelNeeded;
  const startCoordinator = start.retry;
  const providerMissing = start.providerMissing;
  const events = snapshot.conversation.events;
  const mirror = snapshot.conversation.turns;
  const runId = archived ? null : snapshot.conversation.runId;
  const documentGround =
    usePreference("document_ground") === "grey" ? "grey" : "white";
  const [paneTab, setPaneTab] = useState<{ value: string } | null>(null);
  // The tab the project view shows, which the sidebar marks while the view is open.
  const [shownTab, setShownTab] = useState<string | null>(null);
  const documentPaneRef = useRef<HTMLElement>(null);
  // The project view open over the conversation.
  const [projectOpen, setProjectOpen] = useState(false);
  const [enablingAi, setEnablingAi] = useState(false);
  const rolesAtWork = useRolesAtWork(projectId);
  const reload = useRoomReload(projectId, status);
  const composer = useComposer({
    projectId,
    openingMessage,
    mirror,
    onChanged,
    reload,
  });
  const { sending, setSending } = composer;
  const { questions, openQuestion, answer, outcomes } = useQuestions({
    projectId,
    runId,
    loaded: snapshot.conversation.questions,
    archived,
    reload,
    onChanged,
    setSending,
  });
  const screenQuestion =
    openQuestion !== undefined && showsScreen(openQuestion)
      ? openQuestion
      : undefined;
  // A screen asking the person to accept something takes their comments, as their typed words, as
  // the changes they want in place of accepting.
  const screenAsks =
    screenQuestion === undefined
      ? undefined
      : screenWords(screenQuestion.asked.plugin, screenQuestion.asked.action);
  const screenDecides =
    screenQuestion !== undefined && screenAsks?.decides === true;
  // What the open screen asks of the prompt box, as the composer's placeholder says it.
  const screenReply = screenAsks?.reply;

  const { liveRun, settling, turns, coordinatorResults, liveTurn } =
    useLiveTurn({
      projectId,
      runId,
      runTenantId,
      events,
      mirror,
      reload,
      composer,
    });

  const decisions = useDecisions({
    projectId,
    status,
    snapshot,
    onChanged,
    composer,
  });
  const {
    waits,
    settledApprovals,
    openApproval,
    approvalBusy,
    readPendingApprovals,
  } = decisions;
  useReloadOnHold(decisions.awaitingApproval, reload);

  useSettleReloads(settling, reload);

  const mailThreads = snapshot.conversation.threads;
  const specialistUpdates = useMemo(
    () => threadUpdates(mailThreads),
    [mailThreads],
  );
  const latestAssistant = [...mirror]
    .reverse()
    .find((turn) => turn.role === "assistant")?.text;
  const phase = roomPhase({
    status,
    bound: events !== null,
    mirror,
    lastTurnRole: turns.at(-1)?.role,
    liveRun,
    runId,
    waits,
    openApprovals: decisions.openApprovalIds,
    questionOpen: openQuestion !== undefined,
    coordinator: decisions.activity?.agents.find(
      (agent) => agent.role === "coordinator",
    ),
    sending,
    approvalBusy,
    failed: composer.failed,
    awaitingSince: composer.awaitingSince,
    startFault,
    modelNeeded: modelNeeded !== null,
    providerMissing,
  });
  const { streaming, thinking } = phase;
  const shownTurns = withLiveTurn(turns, liveTurn, streaming);
  const lastShown = shownTurns.at(-1);
  const replies =
    lastShown?.role === "assistant" && !streaming && !sending
      ? suggestedReplies(lastShown.text)
      : [];
  const sentId = sentItemId(turns, composer.sent.length > 0);
  const addToPrompt = (passage: PassageQuote) =>
    composer.add(formatPassageQuote(passage));
  const openProject = (tab: string) => {
    setPaneTab({ value: tab });
    setProjectOpen(true);
  };
  // A link opens the page it names, so the design opens on its plan. Only the mockup's row opens the mockup.
  const openDocument = (id: string) => openProject(id);
  const { composerDisabled, awaitingBind } = phase;
  const { deliver, send, chooseApproach, typedYes, requestChanges } =
    useDelivery({
      composer,
      question: { openQuestion, answer },
      decisions,
      composerDisabled,
    });
  useBindPoll(awaitingBind, reload, startCoordinator);
  const [restoring, setRestoring] = useState(false);
  const [restoreFault, setRestoreFault] = useState<string | null>(null);
  const restore = async () => {
    setRestoring(true);
    setRestoreFault(null);
    try {
      await restoreProject(projectId);
      await refetchProject();
      onChanged();
    } catch (cause) {
      setRestoreFault(
        await humanFaultWithCode(cause, wording.archivedProject.restoreFailed),
      );
    } finally {
      setRestoring(false);
    }
  };
  const {
    artifacts,
    shownDocuments,
    seen,
    documentState,
    paneDeliverables,
    paneDocuments,
    selected,
    selectedState,
    chooseDocument,
    retryDocument,
    approveRead,
    markDocumentSeen,
  } = usePaneDocuments({
    projectId,
    archived,
    snapshot,
    following: {
      working: streaming || thinking,
      liveText: `${liveTurn?.text ?? ""}\n${latestAssistant ?? ""}`,
    },
    reload,
    onChanged,
    closeProject: () => setProjectOpen(false),
  });
  // Words that name a document work already builds from say, as they are typed, what sending
  // restarts; Send still sends at once. Without a read of who is at work there is nothing to say.
  const restarting =
    rolesAtWork === undefined || composer.text.trim() === ""
      ? undefined
      : earlierDocumentRole(composer.text, artifacts, rolesAtWork);
  const { dispatches, allDispatches, dispatchRoom, cards, runResults } =
    useRunCards({
      projectId,
      runTenantId,
      snapshot,
      shownTurns,
      coordinatorResults,
      shownDocuments,
      waits,
      reload,
      openProject,
      openDocument,
    });

  const {
    screenOf,
    projectValues,
    supplies,
    act,
    pluginScreens,
    concepts,
    waitsOn,
  } = useScreenSupplies({
    projectId,
    archived,
    runTenantId,
    snapshot,
    artifacts,
    documentState,
    dispatches,
    screenQuestion,
    questions,
    shownDocuments,
    openDocument,
    drafted: composer.text.trim().length > 0,
    reload,
  });
  const { liveApp, userManual } = useAppPreview({
    projectId,
    snapshot,
    paneDeliverables,
    rolesAtWork,
  });
  // Until the first document is filed or there is an app, the project view has nothing to show.
  const nothingYet =
    paneDeliverables.length === 0 && concepts.length === 0 && liveApp === null;
  const projectShown = projectOpen && !nothingYet;
  const session: RoomSession = {
    projectId,
    archived,
    projectOpen: projectShown,
    shown: projectShown ? shownTab : null,
    openTab: openProject,
    send: (message) => void deliver(message),
    reload,
  };
  // Comments go as an ordinary message, so they wait while a question or approval would take it,
  // unless the question asks to accept something, which they answer by asking for changes.
  const commentDrafts = useCommentDrafts(session, {
    question: openQuestion !== undefined && !screenDecides,
    approval: openApproval !== undefined,
    sending: phase.busy,
    approvalOpenNow: async () =>
      openApprovalOf(await readPendingApprovals()) !== undefined,
    mail: (message, clearBox) =>
      screenDecides
        ? deliver(message, clearBox)
        : composer.mail(message, clearBox),
  });
  // Accepting what a screen asks closes the project view on the conversation, where the work
  // carries on; asking for changes keeps the page open until the next version is filed.
  const answerScreen = async (signalName: string, given: QuestionAnswer) => {
    const accepted =
      screenDecides &&
      signalName === screenQuestion.signalName &&
      "output" in given;
    const sent = await answer(signalName, given);
    if (sent && accepted) setProjectOpen(false);
    return sent;
  };
  const promptBox = usePromptBox(session, {
    openQuestion,
    onAnswer: answerScreen,
    sending,
    decisions,
    typedYes:
      typedYes.held === null
        ? null
        : { held: typedYes.held, onUndo: typedYes.undo },
    onRequestChanges: requestChanges,
    plan: snapshot.plan.steps,
    // A screen with a tab of its own waits there, not in the space.
    screens: snapshot.plan.screens.filter((screen) => !inTab(screen)),
    screenOf,
    supplies,
    projectValues,
    act,
    restarts:
      restarting === undefined
        ? null
        : wording.earlierDocument.restarts(restartedWork(restarting)),
    thinking,
    dispatches: allDispatches,
    dispatchRoom,
    failed: snapshot.failed,
    lastSentAt: lastSentAt(composer.awaitingSince, turns),
    documents: paneDeliverables,
    seen,
    hasApp: liveApp !== null,
  });
  const { sidebar, projectMenu } = useProjectSidebar(session, {
    title: projectTitle,
    project: menuProject,
    onProjectChanged: onChanged,
    onProjectError,
    onOpenSettings,
    onNewProject,
    plan: snapshot.plan.steps,
    documents: paneDocuments,
    appShown: liveApp !== null,
    manualShown: userManual !== null,
    waitsOn,
  });
  const emptyConversation = () => {
    if (archived) return "archived";
    return shownTurns.length === 0 && !thinking ? "new" : null;
  };

  return {
    view: {
      title: projectTitle,
      layout: {
        projectReady: !nothingYet,
        // The view cannot be open once it has nothing to show, or the prompt box is placed in it unseen.
        projectOpen: projectShown,
        documentGround,
        waitedOnShown:
          projectOpen &&
          !nothingYet &&
          waitsOn !== null &&
          (shownTab === waitsOn || shownTab === documentTab(waitsOn)),
        onCloseProject: () => setProjectOpen(false),
      },
      conversation: {
        thread: {
          turns: shownTurns,
          updates: specialistUpdates,
          thinking,
          documents: paneDeliverables.map((item) => ({
            id: item.kind,
            title: item.title,
          })),
          onOpenDocument: openDocument,
          approvals: settledApprovals,
          results: new Map([...coordinatorResults, ...runResults]),
          runs: cards,
          live: (dispatch) => dispatchLive(dispatch, dispatchRoom),
          standing: (unit) => workUnitStanding(unit, dispatchRoom),
          ...(sentId === undefined ? {} : { sentId }),
          questions,
          projectValues,
          screenOf,
          screenSupplies: supplies,
        },
        empty: emptyConversation(),
      },
      dock: roomDock({
        archived,
        restore: {
          restoring,
          fault: restoreFault,
          onRestore: () => void restore(),
        },
        modelNeeded: modelNeeded?.message ?? null,
        providerMissing,
        startFault,
        onOpenSettings,
        onRetryStart: () => void startCoordinator(),
        phase,
        composer: {
          box: composer.box,
          onSend: send,
          onEnableAi: () => setEnablingAi(true),
          suggestedReplies: replies,
          onReply: (reply) => void deliver(reply),
          approvalOpen: openApproval !== undefined,
          questionOpen: openQuestion !== undefined,
          screenReply,
          nothingFiled: nothingYet,
          promptBox,
          comments: commentDrafts.box,
        },
      }),
      sidebar,
      waiting: promptBox.waiting,
      space:
        promptBox.space === null
          ? null
          : {
              ...promptBox.space,
              shows:
                promptBox.space.shows === null
                  ? null
                  : documentTab(promptBox.space.shows),
            },
      documentPane: {
        projectId,
        projectTitle,
        manual: userManual,
        concepts,
        openTab: paneTab,
        onShownChange: setShownTab,
        documents: paneDocuments,
        selectedId: selected === null ? null : selected.kind,
        state: selected ? (selectedState ?? { status: "loading" }) : undefined,
        ...(selectedState?.status === "error" && selectedState.retryable
          ? {
              onRetry: () => {
                if (selected) void retryDocument(selected);
              },
            }
          : {}),
        onSelect: chooseDocument,
        onSeen: markDocumentSeen,
        onReadVersion: async (version) => {
          if (selected === null) throw new Error("No artifact is selected.");
          const { content, filedAt, approaches } = await readArtifact(
            projectId,
            selected.artifactId,
            version,
          );
          return approaches === undefined
            ? { content, filedAt }
            : { content, filedAt, approaches };
        },
        approachChoice: {
          chosen: (meta, filedAt) =>
            chosenApproach(meta, turns, Date.parse(filedAt)),
          ...(archived ? {} : { choose: chooseApproach }),
        },
        ...(archived
          ? {}
          : {
              onAddToPrompt: addToPrompt,
              comments: commentDrafts.comments,
              onDeliverMessage: (message: string) => deliver(message),
              onApprove: approveRead,
            }),
        plugins: pluginScreens.tabs,
      },
      tabStatus: pluginScreens.tabs.flatMap(({ value, label, status }) =>
        status === undefined
          ? []
          : [{ ...status, tab: label, onOpen: () => openProject(value) }],
      ),
      paneRef: documentPaneRef,
    },
    projectMenu,
    enableAi: { open: enablingAi, onOpenChange: setEnablingAi },
    liveApp,
    spaceScreen: promptBox.spaceScreen,
    questionOutcomes: outcomes,
  };
}
