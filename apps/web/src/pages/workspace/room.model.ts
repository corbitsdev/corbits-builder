import type { AnswerOutcome } from "./question-outcome.tsx";
/**
 * What the project room does.
 *
 * One conversation with the coordinator. The transcript is the durable
 * mirror's committed person and assistant text. While a message run is in
 * progress, text, thinking, and tool frames from the run's SSE stream show in
 * the log as one live turn; each call's part is replaced when the mirror
 * commits that text. The stream also says when to read the room again; a slow
 * fallback read covers what it cannot see. `useRoomGate` reads the project and
 * its room and starts its coordinator; `useRoom` works on the loaded snapshot.
 */
import { wording, type SettingsTab } from "../../config.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  skipToken,
  usePrefetchQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  projectActivityQuery,
  projectRunStatesQuery,
  useRolesAtWork,
} from "./project-activity.ts";
import { dispatchLive } from "./dispatch.ts";
import { earlierDocumentRole, restartedWork } from "./earlier-document.ts";
import { ProductApiError, type ProjectArtifact } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { toast } from "sonner";
import type { SpaceScreenProps } from "./plugin-screens.tsx";
import { useCommentDrafts, usePromptBox } from "./prompt-box.model.ts";
import { acceptedMaterialsQuery, useComposer } from "./composer.model.ts";
import { runStepsQuery, savedRunIds, useSavedRunSteps } from "./run-preview.ts";
import { refusalBody } from "../../api/transport.ts";
import {
  approveDocument,
  readArtifact,
  readProjectValues,
  runPluginAction,
} from "../../api/artifacts.ts";
import { documentsForPane } from "./document-read.ts";
import {
  getProject,
  restoreProject,
  startProjectCoordinator,
} from "../../api/projects.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import {
  showsScreen,
  type QuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { keys } from "../../queries/keys.ts";
import { useQuestions } from "./questions.model.ts";
import { openDecisionsQuery, useDecisions } from "./decisions.model.ts";
import { useDelivery } from "./delivery.model.ts";
import { useRunCards } from "./run-cards.model.ts";
import { useFiledVersions } from "./filed-versions.ts";
import { threadUpdates } from "./specialist-updates.ts";
import { openApprovalOf } from "./collaboration.ts";
import { chosenApproach } from "./approach-choice.ts";
import {
  followDeliverableId,
  shownDeliverableId,
  type DocumentChoice,
} from "./tab-follow.ts";
import {
  useBindPoll,
  useReloadOnHold,
  useRoomReload,
  useSettleReloads,
} from "./room-reload.model.ts";
import {
  documentTab,
  paneArtifacts,
  paneDocument,
  shownDocument,
  tabbedArtifacts,
} from "./pane-documents.ts";
import type { DeliverableState } from "./deliverable-block.tsx";
import { formatPassageQuote, type PassageQuote } from "./passage-quote.ts";
import { humanFault, humanFaultWithCode } from "../../human-fault.ts";
import { suggestedReplies } from "./suggested-replies.ts";
import { sentItemId, withLiveTurn } from "./visible-chat.ts";
import {
  keptRoom,
  loadProjectRoom,
  paneDocumentKey,
  reloadProjectDocument,
  roomSnapshotReady,
  type RoomSnapshot,
} from "./load-room.ts";
import { useUserManual } from "./user-manual.model.ts";
import { workUnitStanding } from "./work-unit-step.model.ts";
import { conceptTab, DESIGN_OPTION, reviewApproval } from "./design-concept.ts";
import { designConcepts } from "./design-concepts.model.ts";
import { useLiveAppPresence } from "./live-app.model.ts";
import { usePreference } from "../../queries/preferences.ts";
import { markSeen, useSeenVersions } from "./seen-versions.ts";
import {
  needsModelSetup,
  type EnableAiDialogProps,
} from "../model-setup.model.ts";
import { useModelCatalog } from "../model-catalog.ts";
import type { RoomContent } from "./room.view.tsx";
import { roomDock } from "./room-dock.ts";
import { lastSentAt, roomPhase } from "./room-status.ts";
import { useProjectSidebar } from "./project-sidebar.model.ts";
import type { MenuProject, ProjectMenuHost } from "../project-menu.model.ts";
import { parseBundle } from "./design-bundle.ts";
import type {
  ChoosableConcept,
  HostSupplies,
  ListedHostProps,
  ReviewedDesign,
} from "./screen-question.tsx";
import type { RoomSession } from "./room-session.ts";
import { useLiveTurn } from "./live-turn.model.ts";
import { screenWords, writesCode } from "./roles.ts";
import { inTab, pluginTabs, screensFor, selectionNames } from "./screens.ts";

// A coder at work can report how the project's program starts at any time.
const RUN_POLL_MS = 5_000;
const RUN_VALUE = "stack.run";

const MODEL_CHOICE_REFUSALS: ReadonlySet<string> = new Set([
  "model_provider_missing",
  "model_profile_required",
]);

// The hub's own sentence for a project with no model to run on, which only the person can settle.
async function modelRefusal(
  cause: unknown,
): Promise<{ code: string; message: string } | undefined> {
  if (!(cause instanceof ProductApiError) || cause.response.status !== 409)
    return undefined;
  const body = await refusalBody(cause);
  return body !== null &&
    typeof body === "object" &&
    "code" in body &&
    "message" in body &&
    typeof body.code === "string" &&
    MODEL_CHOICE_REFUSALS.has(body.code) &&
    typeof body.message === "string"
    ? { code: body.code, message: body.message }
    : undefined;
}

type ModelNeeded = { code: string; message: string };

export type StageWorkspaceProps = {
  /** The open project's id. */
  projectId: string;
  projectTitle: string;
  /** Whether the project list shows it archived, so an archive or restore made elsewhere is read again. */
  listedArchived?: boolean;
  onChanged: () => void;
  /** The project as its options menu reads it; absent until the project list has it. */
  menuProject?: MenuProject;
  onProjectError: (cause: unknown) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onNewProject: () => void;
  /** The opening sentence the project was started with. It is not a stored
   *  artifact but the first conversation message, sent here once the
   *  coordinator binds. */
  openingMessage?: string;
};

/** The room's first read in hand, and how its coordinator's start went. */
type LoadedRoom = {
  status: string;
  runTenantId: string | undefined;
  /** Null events means no coordinator is bound yet (the hub's 409). */
  snapshot: RoomSnapshot;
  start: {
    fault: string | null;
    modelNeeded: ModelNeeded | null;
    providerMissing: boolean;
    retry: () => Promise<void>;
  };
  refetchProject: () => Promise<unknown>;
};

export type ReadyRoomProps = StageWorkspaceProps & LoadedRoom;

/**
 * Reads the project and its room, and starts its coordinator, while the room shows its loading
 * or fault state; the room is ready only with a loaded snapshot.
 */

export function useRoomGate({
  projectId,
  listedArchived,
}: StageWorkspaceProps):
  | { state: "loading" }
  | { state: "failed"; onRetry: () => void }
  | { state: "ready"; room: LoadedRoom } {
  // An archived project has no coordinator or conversation to read, so the room waits on its lifecycle.
  const projectRead = useQuery({
    queryKey: keys.project.of(projectId),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: () => getProject(projectId),
  });
  // The saved copy paints the room at once. The project list learns of an archive first, so it
  // wins while the read catches up.
  const project = projectRead.data;
  const status = listedArchived ? "archived" : project?.status;
  // A saved status may predate an archive, so only a read made since opening starts or stops work.
  const confirmed = projectRead.isFetchedAfterMount ? status : undefined;
  const archived = status === "archived";
  const listedBefore = useRef(listedArchived);
  useEffect(() => {
    if (listedBefore.current === listedArchived) return;
    listedBefore.current = listedArchived;
    void projectRead.refetch();
  }, [listedArchived]);
  const roomKey = keys.projectRoom.of(projectId);
  const room = useQuery({
    queryKey: roomKey,
    enabled: status !== undefined,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    meta: { persist: keptRoom },
    queryFn: ({ client }) => loadProjectRoom(projectId, client, !archived),
  });
  const [startFault, setStartFault] = useState<string | null>(null);
  // Why the coordinator has no model to run on, which only the person can settle.
  const [modelNeeded, setModelNeeded] = useState<ModelNeeded | null>(null);
  // Only a missing provider is settled by connecting one; a profile choice needs Settings.
  const providerMissing = modelNeeded?.code === "model_provider_missing";
  const startCoordinator = async () => {
    setStartFault(null);
    setModelNeeded(null);
    try {
      await startProjectCoordinator(projectId);
      await room.refetch();
    } catch (cause) {
      const needed = await modelRefusal(cause);
      if (needed !== undefined) return setModelNeeded(needed);
      setStartFault(
        await humanFaultWithCode(cause, wording.message.coordinatorNotStarted),
      );
    }
  };
  // Opening an active project starts its coordinator when it is not running; a running one is
  // left alone. A project archived while open drops the conversation it can no longer read.
  useEffect(() => {
    if (confirmed === "active") void startCoordinator();
    else if (confirmed === "archived" && room.data !== undefined)
      void room.refetch();
  }, [projectId, confirmed]);
  const catalog = useModelCatalog();
  const providerConnected =
    catalog.data !== undefined && !needsModelSetup(catalog.data.providers);
  // However the provider gets connected (Enable AI, Settings, another tab, the server), the
  // shared catalog read sees it and the refused start is tried again. Only on that change: a hub
  // that still refuses would otherwise retry on every refusal.
  useEffect(() => {
    if (providerConnected && providerMissing) void startCoordinator();
  }, [providerConnected]);
  // The room's other reads start with it, so the ready room mounts with them in hand.
  usePrefetchQuery(projectActivityQuery(projectId));
  usePrefetchQuery(projectRunStatesQuery(projectId));
  usePrefetchQuery(acceptedMaterialsQuery(projectId));
  // A prefetch cannot wait on the project's status, so this read observes the decisions instead.
  useQuery(openDecisionsQuery(projectId, status === "active"));
  useLiveAppPresence(projectId);
  // The coordinator's saved calls give its replies their steps back, so the room waits on them
  // rather than drawing its rows twice.
  const coordinatorSteps = useSavedRunSteps(
    project?.tenantId,
    archived ? null : (room.data?.conversation.runId ?? null),
  );
  // The saved records of the runs those calls started say how each ended, so a row is drawn ended.
  const tenantId = project?.tenantId;
  const startedRuns = useQueries({
    queries:
      tenantId === undefined
        ? []
        : savedRunIds(coordinatorSteps.steps).map((started) =>
            runStepsQuery(tenantId, started, false),
          ),
  });

  if (status === undefined) {
    if (projectRead.isError)
      return { state: "failed", onRetry: () => void projectRead.refetch() };
    return { state: "loading" };
  }
  const snapshot = room.data;
  if (
    !roomSnapshotReady(projectId, snapshot) ||
    coordinatorSteps.pending ||
    startedRuns.some((read) => read.isPending)
  ) {
    if (room.isError)
      return { state: "failed", onRetry: () => void room.refetch() };
    return { state: "loading" };
  }
  return {
    state: "ready",
    room: {
      status,
      // Each project is its own tenant beneath the workspace, and its runs live there.
      runTenantId: project?.tenantId,
      snapshot,
      start: {
        fault: startFault,
        modelNeeded,
        providerMissing,
        retry: startCoordinator,
      },
      refetchProject: projectRead.refetch,
    },
  };
}

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
  const queryClient = useQueryClient();
  const archived = status === "archived";
  const startFault = start.fault;
  const modelNeeded = start.modelNeeded;
  const startCoordinator = start.retry;
  const providerMissing = start.providerMissing;
  const events = snapshot.conversation.events;
  const mirror = snapshot.conversation.turns;
  const runId = archived ? null : snapshot.conversation.runId;
  const selectionKeys = selectionNames();
  const workspaceRead = useQuery({
    queryKey: keys.workspaceTenant,
    queryFn: workspaceTenantId,
  });
  const selection = useQuery({
    queryKey: keys.projectValues.selection(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn:
      selectionKeys.length === 0
        ? skipToken
        : ({ signal }) => readProjectValues(projectId, selectionKeys, signal),
  });
  const screenOf = useMemo(
    () => screensFor(selection.data ?? {}),
    [selection.data],
  );
  const artifacts = paneArtifacts(snapshot.artifacts);
  const documents = snapshot.documents;
  const shownDocuments = artifacts.map((item) =>
    shownDocument(item, documents[paneDocumentKey(projectId, item)]),
  );
  // Kept stable, so an open screen reads the project's values once rather than on every render.
  const projectValues = useMemo(
    () => ({
      read: (keys: readonly string[], signal: AbortSignal) =>
        readProjectValues(projectId, keys, signal),
    }),
    [projectId],
  );
  const stakeholderApprovals =
    usePreference("experimental_approvals") === "yes" ? "on" : "off";
  const documentGround =
    usePreference("document_ground") === "grey" ? "grey" : "white";
  const seen = useSeenVersions();
  const [documentChoice, setDocumentChoice] = useState<DocumentChoice | null>(
    null,
  );
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
  // A document opened from the screen waiting in the box, so the plan can say it waits on the
  // person while that screen stays unanswered.
  const [openedFromScreen, setOpenedFromScreen] = useState<{
    signal: string;
    id: string;
  } | null>(null);
  const waitsOn =
    openedFromScreen !== null &&
    screenQuestion?.signalName === openedFromScreen.signal
      ? openedFromScreen.id
      : null;

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
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const retryDocument = async (item: ProjectArtifact) => {
    const key = paneDocumentKey(projectId, item);
    if (documents[key]?.status !== "error") return;
    setRetryingKey(key);
    try {
      await reloadProjectDocument(projectId, key, queryClient, !archived);
    } catch (cause) {
      toast.error(humanFault(cause, wording.documentRetryFailed));
    } finally {
      setRetryingKey((current) => (current === key ? null : current));
    }
  };
  const documentState = (
    item: ProjectArtifact,
  ): DeliverableState | undefined => {
    const key = paneDocumentKey(projectId, item);
    if (retryingKey === key) return { status: "loading" };
    return documents[key];
  };

  const addToPrompt = (passage: PassageQuote) =>
    composer.add(formatPassageQuote(passage));
  const chooseDocument = (id: string) =>
    setDocumentChoice({ id, filedCount: filed.length });
  // The person approves the document they read; the next room read shows it approved. Approved,
  // it is done with, so the project view closes on the conversation.
  const approveRead = async (id: string, version: number) => {
    const item = paneDeliverables.find((entry) => entry.kind === id);
    if (item === undefined) return;
    try {
      await approveDocument(projectId, item.artifactId, version);
      setProjectOpen(false);
      reload();
      onChanged();
    } catch (cause) {
      toast.error(
        await humanFaultWithCode(cause, wording.documentApproval.failed),
      );
    }
  };
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
  // Words that name a document work already builds from say, as they are typed, what sending
  // restarts; Send still sends at once. Without a read of who is at work there is nothing to say.
  const restarting =
    rolesAtWork === undefined || composer.text.trim() === ""
      ? undefined
      : earlierDocumentRole(composer.text, artifacts, rolesAtWork);
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
  // Each concept's option is its own tab beside the others, never an ordinary document.
  const options = artifacts.filter((item) => item.kind === DESIGN_OPTION);
  const paneDeliverables = documentsForPane(
    tabbedArtifacts(artifacts, stakeholderApprovals),
    documentState,
  );
  const markDocumentSeen = (id: string) => {
    const item = paneDeliverables.find((entry) => entry.kind === id);
    if (item !== undefined) markSeen(seen, item.artifactId, item.version);
  };
  const inFlight = snapshot.inFlight;
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
  const design = artifacts.find((item) => item.kind === "design");
  // The design a review screen shows: the newest design option, else the filed design.
  const reviewed = options.at(-1) ?? design;
  const reviewedState =
    reviewed === undefined ? undefined : documentState(reviewed);
  const reviewedContent =
    reviewedState?.status === "ready"
      ? reviewedState.document.content
      : undefined;
  const reviewedFiles = useMemo(
    () => (reviewedContent === undefined ? null : parseBundle(reviewedContent)),
    [reviewedContent],
  );
  const reviewedDesign = (): ReviewedDesign | null => {
    if (reviewed === undefined || reviewedFiles === null) return null;
    return {
      files: reviewedFiles,
      version: reviewed.version,
      approval: reviewApproval(reviewed),
    };
  };
  // Concepts stay to compare until the chosen one is filed as the design, or a new round starts.
  const concepts =
    design !== undefined && !inFlight.some((run) => run.concept !== undefined)
      ? []
      : designConcepts(
          options,
          dispatches.flatMap(({ concept, direction }) =>
            concept === undefined || direction === undefined
              ? []
              : [{ label: concept, direction }],
          ),
          (option) => {
            const state = documentState(option);
            return state?.status === "ready"
              ? state.document.content
              : undefined;
          },
          design !== undefined && design.approvedVersion === design.version
            ? design.title
            : undefined,
        );
  // Filed concepts wait on the person's choice on the designer's choose screen.
  const choosable = concepts.some((concept) => concept.chosen) ? [] : concepts;
  // Each filed concept's bundle, parsed once per version it is filed at rather than on every
  // render of the room; the key names exactly the contents parsed.
  const choosableKey = choosable
    .map(({ option }) => `${option.artifactId}@${String(option.version)}`)
    .join("\n");
  const choosableFiles = useMemo(
    () => choosable.map((concept) => parseBundle(concept.content)),
    [choosableKey],
  );
  const choosableConcepts = (): ChoosableConcept[] =>
    choosable.flatMap((concept, index) => {
      const files = choosableFiles[index];
      const filed = options.find(
        (option) => option.artifactId === concept.option.artifactId,
      );
      if (files === undefined || files === null || filed === undefined)
        return [];
      return [
        {
          label: concept.label,
          direction: concept.direction,
          files,
          version: filed.version,
          approval: reviewApproval(filed),
        },
      ];
    });
  const supplies: HostSupplies = {
    design: reviewedDesign(),
    designConcepts: choosableConcepts(),
    // The last round's answer on the same screen, so the person sees what they asked for before.
    earlierAnswer:
      screenQuestion === undefined
        ? undefined
        : questions
            .flatMap((question) =>
              question.signalName !== screenQuestion.signalName &&
              showsScreen(question) &&
              question.asked.plugin === screenQuestion.asked.plugin &&
              question.asked.action === screenQuestion.asked.action &&
              question.status === "answered" &&
              "output" in question.answer
                ? [question.answer.output]
                : [],
            )
            .at(-1),
    documents: {
      list: shownDocuments,
      open: (id) => {
        if (screenQuestion !== undefined)
          setOpenedFromScreen({ signal: screenQuestion.signalName, id });
        openDocument(id);
      },
    },
    reply: { drafted: composer.text.trim().length > 0 },
    tenants:
      runTenantId === undefined || workspaceRead.data === undefined
        ? null
        : { project: runTenantId, workspace: workspaceRead.data },
    asked: (signalName) =>
      snapshot.plan.asked.find((each) => each.signalName === signalName)?.data,
  };
  const actFromScreen: ListedHostProps["act"] = async (
    plugin,
    action,
    input,
  ) => {
    try {
      await runPluginAction(projectId, plugin, action, input);
    } catch (cause) {
      return humanFault(cause, wording.questions.answerFault.refused);
    }
    reload();
    return undefined;
  };
  const pluginScreens = pluginTabs({
    screens: archived ? [] : snapshot.plan.screens,
    screenOf,
    supplies,
    act: actFromScreen,
  });
  // Each read times its own wake, so a screen counting down is read again as its clock says.
  const { rereadIn } = pluginScreens;
  useEffect(() => {
    if (rereadIn === undefined) return;
    const timer = setTimeout(() => reload(), rereadIn);
    return () => clearTimeout(timer);
  }, [snapshot, rereadIn, reload]);
  const appFiled = snapshot.artifacts.some((item) => item.kind === "app");
  const firstBuilder = appFiled ? undefined : inFlight.find(writesCode);
  // There is an app to preview once one is filed, built here or imported, or a coder is building
  // it; a filed build plan shows where it will appear.
  const appComing =
    appFiled ||
    firstBuilder !== undefined ||
    paneDeliverables.some((item) => item.kind === "build_plan");
  // Only a project that says how its program starts, its stack.run, serves something to preview,
  // whatever its stack; a command-line tool has none.
  const run = useQuery({
    queryKey: keys.projectValues.run(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: inFlight.some(writesCode) ? RUN_POLL_MS : false,
    queryFn: appComing
      ? ({ signal }) => readProjectValues(projectId, [RUN_VALUE], signal)
      : skipToken,
  });
  const servesApp = (run.data?.[RUN_VALUE] ?? null) !== null;
  const liveApp =
    appComing && servesApp ? { projectId, builder: firstBuilder } : null;
  // The manual follows the app, so it is read again while the coder works.
  const userManual = useUserManual(
    projectId,
    liveApp !== null,
    rolesAtWork !== undefined &&
      [...rolesAtWork].some((role) => writesCode({ role })),
  );
  const filed = useFiledVersions({
    projectId,
    documents: artifacts.map((item) =>
      item.kind === DESIGN_OPTION
        ? {
            kind: conceptTab(item.title),
            title: wording.design.conceptTitle(item.title),
            version: item.version,
          }
        : item,
    ),
  });
  const followId = followDeliverableId(
    paneDeliverables.map((item) => ({
      id: item.kind,
      title: item.title,
      filed: true,
    })),
    {
      filedDeliverableId: filed.at(-1)?.kind ?? null,
      working: streaming || thinking,
      liveText: `${liveTurn?.text ?? ""}\n${latestAssistant ?? ""}`,
    },
  );
  const shownId = shownDeliverableId({
    choice: documentChoice,
    filedCount: filed.length,
    followId,
  });
  const selected =
    paneDeliverables.find((item) => item.kind === shownId) ?? null;
  const selectedState = selected === null ? undefined : documentState(selected);

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
    act: actFromScreen,
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
  const paneDocuments = paneDeliverables.map((item) =>
    paneDocument(item, seen),
  );
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
