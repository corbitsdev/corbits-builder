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
import { wording } from "../../config.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  queryOptions,
  skipToken,
  usePrefetchQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type AttachmentItem,
  type AttachmentRejection,
  type ConversationPart,
  useAttachments,
} from "@corbits/react-ui";
import {
  heldOnApproval,
  projectActivityQuery,
  projectRunStatesQuery,
  useProjectActivity,
  useProjectRunStates,
  useRolesAtWork,
} from "./project-activity.ts";
import {
  dispatchLive,
  filedDispatches,
  noteDispatch,
  partsDispatches,
  runDispatch,
  type DispatchRoom,
  type RunEnd,
} from "./dispatch-card.tsx";
import { earlierDocumentRole } from "./earlier-document.ts";
import { ProductApiError, type ProjectArtifact } from "@corbits-builder/client";
import {
  isDocumentKind,
  type InFlightRun,
} from "@corbits-builder/schemas/artifact";
import { toast } from "sonner";
import { answerQuestion, sendMessage } from "../../api/conversation.ts";
import type { QuestionAnswer } from "@intx/types/signals";
import { subscribeWorkflowRun } from "../../api/run-stream.ts";
import {
  savedResults,
  savedTurnSteps,
  useRunStreams,
  useSavedRunSteps,
} from "./run-preview.ts";
import { stopRun } from "../../api/activity.ts";
import { refusalBody } from "../../api/transport.ts";
import {
  acceptedMaterials,
  approveDocument,
  attachMaterials,
  declinePlanStep,
  goAheadPlanStep,
  restorePlanStep,
  setPlanStepAskFirst,
  removeMaterial,
  readArtifact,
  readProjectValues,
} from "../../api/artifacts.ts";
import { documentsForPane } from "./document-read.ts";
import {
  getProject,
  restoreProject,
  startProjectCoordinator,
} from "../../api/projects.ts";
import type { ChatMessage, Wait } from "../../api/types.ts";
import {
  deliveredText,
  parkedQuestions,
} from "@corbits-builder/schemas/conversation";
import { keys } from "../../queries/keys.ts";
import { turnItemId } from "./transcript.tsx";
import { useFiledVersions } from "./filed-versions.tsx";
import { threadUpdates } from "./specialist-updates.ts";
import { useSettledApprovals, type OpenApproval } from "./settled-approvals.ts";
import {
  chooseApproachWithOpenApproval,
  deliverWithOpenApproval,
  useTypedYes,
} from "./typed-yes.tsx";
import { chosenApproach } from "./approach-choice.ts";
import {
  DRAFT_TAB,
  followDeliverableId,
  LIVE_TAB,
  shownDeliverableId,
  type DocumentChoice,
} from "./tab-follow.ts";
import {
  awaitingCommit,
  awaitingReply,
  committedSteps,
  emptyLiveRun,
  foldLiveRun,
  latestAssistantAt,
  pendingLiveTurn,
  liveTurnStreaming,
  parkedOnApproval,
  waitingOnPerson,
  type LiveRun,
} from "./live-run.ts";
import { createRoomReloader } from "./room-reload.ts";
import {
  latestTurnAt,
  SENDING,
  withPendingSends,
  type SentMessage,
} from "./pending-sends.ts";
import { decideApproval, openDecisions } from "../../api/decisions.ts";
import type { PaneDocument } from "./artifact-pane.tsx";
import type { DeliverableState } from "./deliverable-block.tsx";
import { formatPassageQuote, type PassageQuote } from "./passage-note.tsx";
import { humanFault, humanFaultWithCode, responseCode } from "./human-fault.ts";
import { suggestedReplies } from "./suggested-replies.ts";
import { participantLabel, visibleChatText } from "./visible-chat.ts";
import {
  loadProjectRoom,
  reloadProjectDocument,
  roomDocumentKey,
  roomSnapshotReady,
  type RoomSnapshot,
} from "./load-room.ts";
import { designDraftFiled, useDesignDraft } from "./design-preview.model.ts";
import { useUserManual } from "./user-manual.model.ts";
import { workUnitStanding } from "./work-unit-step.model.ts";
import { conceptOfTab, conceptTab } from "./design-concept.ts";
import { designConcepts, DESIGN_OPTION } from "./design-concepts.model.ts";
import { useLiveAppPresence } from "./live-app.model.ts";
import {
  useWorkspaceApprovalsEnabled,
  type OnOff,
} from "../../workspace-approvals-setting.ts";
import {
  markSeen,
  useSeenVersions,
  type SeenVersions,
} from "./seen-versions.ts";
import {
  projectNextStepQuery,
  useProjectNextStep,
  type NextStepLineProps,
} from "./next-step.model.ts";
import { composerPlaceholder } from "./composer-placeholder.ts";
import {
  needsModelSetup,
  type EnableAiDialogProps,
} from "../model-setup.model.ts";
import { useModelCatalog } from "../settings/model-catalog.ts";
import type { RoomContent, RoomDock } from "./room.view.tsx";
import { parseBundle } from "./design-bundle.ts";
import { MockupFrame } from "./mockup-frame.tsx";
import type {
  ChoosableConcept,
  HostSupplies,
  PageHost,
  ReviewedDesign,
  ScreenQuestionProps,
  ShownDocument,
} from "./screen-question.tsx";
import { inShort } from "./in-short.ts";
import { screensFor, selectionNames } from "./screens.ts";

// The stream says when the room moved. This read covers what it cannot see,
// such as a coordinator run replaced while its old stream stays quiet.
const FALLBACK_RELOAD_MS = 30_000;
// The first build records what the code started from once its workspace is set up.
const STARTER_POLL_MS = 5_000;
const STARTER_VALUE = "stack.starter";
// No coordinator's stream announces the next one binding, so an unbound room reads again until it does.
const BIND_POLL_MS = 1_000;
// A handoff binds within seconds; past this the room starts the coordinator itself, so a start the
// hub could not make shows its refusal instead of an endless thinking mark.
const BIND_WAIT_MS = 15_000;
// After a run closes, the mirror's commit can trail its last frame.
const SETTLE_RELOAD_MS = [1_000, 3_000, 7_000, 15_000];
// Specialist runs whose streams the room holds open at once.
const STREAMED_RUNS = 6;

function acceptedMaterialsQuery(projectId: string) {
  return queryOptions({
    queryKey: keys.acceptedMaterials.of(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => acceptedMaterials(projectId),
  });
}

// Only an active project has a coordinator whose decisions can be open.
function openDecisionsQuery(projectId: string, active: boolean) {
  return queryOptions({
    queryKey: keys.openDecisions.of(projectId),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: active ? () => openDecisions(projectId) : skipToken,
  });
}

function documentApprovalsFrom(waits: readonly Wait[]): OpenApproval[] {
  return waits.flatMap((wait): OpenApproval[] => {
    if (wait.approvalId === undefined || wait.tenantId === undefined) return [];
    const at =
      wait.createdAt === undefined ? Number.NaN : Date.parse(wait.createdAt);
    return [
      {
        approvalId: wait.approvalId,
        tenantId: wait.tenantId,
        ...(Number.isNaN(at) ? {} : { at }),
        ...(wait.toolName === undefined ? {} : { toolName: wait.toolName }),
        ...(wait.subject === undefined ? {} : { subject: wait.subject }),
        ...(wait.packages === undefined ? {} : { packages: wait.packages }),
      },
    ];
  });
}

function openingDraft(
  projectId: string,
  openingMessage: string | undefined,
): SentMessage[] {
  const text = openingMessage?.trim();
  if (text === undefined || text.length === 0) return [];
  return [
    {
      id: `opening:${projectId}`,
      author: "me",
      body: text,
      at: new Date(0).toISOString(),
      after: Number.NEGATIVE_INFINITY,
    },
  ];
}

// Every material shares one kind, but each file is its own tab, so the pane names it by its artifact.
const MATERIAL = "material";
const MATERIAL_TAB = `${MATERIAL}:`;
function paneArtifact(item: ProjectArtifact): ProjectArtifact {
  return item.kind === MATERIAL
    ? { ...item, kind: `${MATERIAL_TAB}${item.artifactId}` }
    : item;
}

const APPROVAL_PACKAGE = "approval_package";

/**
 * The filed artifacts that are the pane's documents: a concept's option has a tab of its own, and
 * an approval package is one only while stakeholder approvals are on.
 */
export function tabbedArtifacts(
  artifacts: readonly ProjectArtifact[],
  approvals: OnOff,
): ProjectArtifact[] {
  return artifacts.filter(
    (item) =>
      item.kind !== DESIGN_OPTION &&
      (approvals === "on" || item.kind !== APPROVAL_PACKAGE),
  );
}

/** A filed artifact as its tab shows it, unread while this viewer has not opened its version. */
function paneDocument(item: ProjectArtifact, seen: SeenVersions): PaneDocument {
  return {
    id: item.kind,
    title: item.title,
    status:
      item.approvedVersion === undefined
        ? wording.documentStatus.drafted(item.version)
        : wording.documentStatus.approved(item.approvedVersion),
    unread: seen[item.artifactId] !== item.version,
    removable: item.kind.startsWith(MATERIAL_TAB),
    ...(isDocumentKind(item.kind)
      ? {
          approval: {
            approvedVersion: item.approvedVersion,
            approvedAt: item.approvedAt,
          },
        }
      : {}),
  };
}

function documentKey(projectId: string, item: ProjectArtifact): string {
  return roomDocumentKey(
    projectId,
    item.kind.startsWith(MATERIAL_TAB) ? { ...item, kind: MATERIAL } : item,
  );
}

/** A filed document as an approval lists it, with its In short section once its body has loaded. */
function shownDocument(
  item: ProjectArtifact,
  state: DeliverableState | undefined,
): ShownDocument {
  const summary =
    state?.status === "ready" && state.document.mediaType === "text/markdown"
      ? inShort(state.document.content)
      : undefined;
  return summary === undefined ? item : { ...item, summary };
}

function rejectionText(
  rejection: AttachmentRejection<File>,
  limits: { maxFiles: number; maxFileBytes: number },
): string {
  if (rejection.reason === "too-many")
    return wording.attach.tooMany(limits.maxFiles);
  if (rejection.reason === "too-large")
    return wording.attach.tooLarge(rejection.file.name, limits.maxFileBytes);
  return wording.attach.duplicate(rejection.file.name);
}

async function attachFaultText(cause: unknown): Promise<string> {
  const code = await responseCode(cause);
  return (
    (code === undefined ? undefined : wording.attach.fault[code]) ??
    humanFault(cause, wording.attach.notSent)
  );
}

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
  onOpenSettings: () => void;
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
  // A status restored from the saved cache may predate an archive, so only a read made since
  // opening counts. The project list learns of an archive first, so it wins while the read catches up.
  const project = projectRead.isFetchedAfterMount
    ? projectRead.data
    : undefined;
  const status = listedArchived ? "archived" : project?.status;
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
    if (status === "active") void startCoordinator();
    else if (status === "archived" && room.data !== undefined)
      void room.refetch();
  }, [projectId, status]);
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
  usePrefetchQuery(projectNextStepQuery(projectId));
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

  if (status === undefined) {
    if (projectRead.isError)
      return { state: "failed", onRetry: () => void projectRead.refetch() };
    return { state: "loading" };
  }
  const snapshot = room.data;
  if (!roomSnapshotReady(projectId, snapshot) || coordinatorSteps.pending) {
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
  onOpenSettings,
  openingMessage,
  status,
  runTenantId,
  snapshot,
  start,
  refetchProject,
}: ReadyRoomProps): {
  view: RoomContent;
  /** The line above the conversation; null on an archived project, which has none. */
  nextStep: NextStepLineProps | null;
  enableAi: EnableAiDialogProps;
  /** The app the build plan builds, once one is filed. */
  liveApp: { projectId: string; builder: InFlightRun | undefined } | null;
  /** The coordinator's open question when its screen is placed over the whole room. */
  pageScreen: ScreenQuestionProps | null;
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
  // An answer the hub accepted closes its question before the next poll shows it, so its card
  // settles at once and later typing goes to the conversation rather than to a closed question.
  const [sentAnswers, setSentAnswers] = useState<
    ReadonlyMap<string, QuestionAnswer>
  >(() => new Map());
  const questions = (
    events === null || archived ? [] : parkedQuestions(events)
  ).map((question) => {
    const sent = sentAnswers.get(question.signalName);
    if (question.answer !== undefined || sent === undefined) return question;
    return {
      at: question.at,
      signalName: question.signalName,
      asked: question.asked,
      answer: sent,
    };
  });
  const selectionKeys = selectionNames();
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
  const openQuestion = questions.find(({ answer }) => answer === undefined);
  const pageQuestion =
    openQuestion !== undefined &&
    "plugin" in openQuestion.asked &&
    screenOf(openQuestion.asked)?.page === true
      ? {
          signalName: openQuestion.signalName,
          asked: openQuestion.asked,
        }
      : undefined;
  // The page screen the person closed to read the conversation, by its question's signal.
  const [closedPage, setClosedPage] = useState<string | null>(null);
  const pageOpen =
    pageQuestion !== undefined && closedPage !== pageQuestion.signalName;
  // What the open page screen sends when the person presses Send, given what they typed.
  const pageSend = useRef<
    ((message: string | undefined) => Promise<boolean>) | null
  >(null);
  // The coder's filed app source is the resume point for a later coder, not a document to read.
  const artifacts = snapshot.artifacts
    .filter((item) => item.kind !== "app")
    .map(paneArtifact);
  const documents = snapshot.documents;
  const [liveRun, setLiveRun] = useState<LiveRun>(emptyLiveRun);
  // Kept stable, so an open screen reads the project's values once rather than on every render.
  const projectValues = useMemo(
    () => ({
      read: (keys: readonly string[], signal: AbortSignal) =>
        readProjectValues(projectId, keys, signal),
    }),
    [projectId],
  );
  const stakeholderApprovals = useWorkspaceApprovalsEnabled();
  const seen = useSeenVersions();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [documentChoice, setDocumentChoice] = useState<DocumentChoice | null>(
    null,
  );
  const [paneTab, setPaneTab] = useState<{ value: string } | null>(null);
  const documentPaneRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Each committed reply's thinking and tool work, as this session watched it.
  const stepsByAt = useRef(new Map<number, readonly ConversationPart[]>());
  // When this session first saw each hand-off, so the document it files reads as its result.
  const dispatchSeen = useRef<DispatchRoom["seen"]>(new Map());
  // Every specialist run this session saw, so its card keeps its result after the run ends.
  const runCards = useRef(new Map<string, InFlightRun>());
  // The runs the person stopped here, which read as stopped before they have wound down.
  const [stoppedHere, setStoppedHere] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The project view open over the conversation.
  const [projectOpen, setProjectOpen] = useState(false);
  const [sent, setSent] = useState<SentMessage[]>(() =>
    openingDraft(projectId, openingMessage),
  );
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [sendFault, setSendFault] = useState<string | null>(null);
  // When this session last sent the coordinator a message, until a run ends after it or it fails.
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const [enablingAi, setEnablingAi] = useState(false);
  const accepted = useQuery(acceptedMaterialsQuery(projectId));
  const limits = accepted.data;
  const [files, setFiles] = useState<readonly AttachmentItem[]>([]);
  const [attachFault, setAttachFault] = useState<string | null>(null);
  const intake = useAttachments({
    attachments: files,
    ...(limits === undefined
      ? {}
      : { maxFiles: limits.maxFiles, maxFileBytes: limits.maxFileBytes }),
  });
  const liveRunRef = useRef<LiveRun>(emptyLiveRun);
  const committedAtRef = useRef<number | null>(null);
  committedAtRef.current = latestAssistantAt(mirror);
  const reportedFailure = useRef<number | null>(null);
  const rolesAtWork = useRolesAtWork(projectId);
  // The line above the conversation is preference-gated; the placeholder is not.
  const projectStatus = useProjectNextStep(projectId);
  const [caution, setCaution] = useState<string | null>(null);
  const [gateDone, setGateDone] = useState(0);
  // The waits that belong to this project, from the open decisions.
  const decisions = useQuery(
    openDecisionsQuery(projectId, status === "active"),
  );
  // Once per outage: each failed poll is a new error, and a dismissed toast stays dismissed.
  useEffect(() => {
    if (!decisions.isError) return;
    toast.error(
      humanFault(decisions.error, "Open decisions could not be read."),
      {
        id: "waits-read",
      },
    );
  }, [decisions.isError]);
  // Undefined until read: an unread list is not one with nothing open.
  const waits = decisions.data;
  const activity = useProjectActivity(projectId);
  useEffect(() => {
    if (!activity.isError) return;
    toast.error(humanFault(activity.error, wording.activity.notRead), {
      id: "activity-read",
    });
  }, [activity.isError]);
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    const reloader = createRoomReloader(() =>
      loadProjectRoom(projectId, queryClient, status === "active"),
    );
    reloadRef.current = reloader.request;
    const timer = setInterval(reloader.request, FALLBACK_RELOAD_MS);
    return () => {
      clearInterval(timer);
      reloader.dispose();
      reloadRef.current = () => {};
    };
  }, [projectId, queryClient, status]);

  useEffect(() => {
    setApprovalBusy(false);
    setApprovalError(null);
    setDocumentChoice(null);
    setPaneTab(null);
    setProjectOpen(false);
    setSent(openingDraft(projectId, openingMessage));
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(null);
    setCaution(null);
    setFiles([]);
    setAttachFault(null);
    stepsByAt.current.clear();
    dispatchSeen.current.clear();
    runCards.current.clear();
    setStoppedHere(new Set());
  }, [projectId, openingMessage]);

  // The durable mirror is the committed transcript. The stream fills the gap
  // while a message run is producing it, and says when to read the room
  // again. A dropped stream reads the room too: the coordinator run it named
  // may have been replaced, and a new run id resubscribes here.
  useEffect(() => {
    liveRunRef.current = emptyLiveRun;
    setLiveRun(emptyLiveRun);
    if (runId === null || runTenantId === undefined) return;
    const reload = () => reloadRef.current();
    return subscribeWorkflowRun(runTenantId, runId, {
      onEvent: (event) => {
        const next = foldLiveRun(
          liveRunRef.current,
          event,
          committedAtRef.current,
        );
        liveRunRef.current = next.run;
        setLiveRun(next.run);
        if (next.reload) reload();
      },
      onChange: reload,
      onReconnect: reload,
      onError: reload,
    }).unsubscribe;
  }, [projectId, runId, runTenantId]);

  // The runs held on an approval, from the polled run states: a coder's package request raises no
  // room event, so the room alone would not say the person's turn came until something else moved.
  const awaitingApproval = heldOnApproval(useProjectRunStates(projectId).data);
  // A room that moved may mean a message reached the coordinator from elsewhere, or a coordinator
  // or coder decision opened; read who is at work and the open decisions. A run parking on an
  // approval moves no room, so the open decisions are read again then too.
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: keys.projectActivity.of(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: keys.openDecisions.of(projectId),
    });
  }, [projectId, queryClient, snapshot, gateDone, awaitingApproval]);

  const settling = awaitingCommit(liveRun, mirror);
  useEffect(() => {
    if (!settling) return;
    const timers = SETTLE_RELOAD_MS.map((ms) =>
      setTimeout(() => reloadRef.current(), ms),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [settling]);

  // A dead run is not a quiet colleague. Say so once, and stop the thinking
  // mark, when the person is still waiting on a reply that will not come.
  useEffect(() => {
    reportedFailure.current = null;
  }, [projectId]);
  useEffect(() => {
    if (!events || mirror.some((turn) => turn.role === "assistant")) return;
    const failure = [...events]
      .reverse()
      .find(
        (event) => event.type === "StepFailed" || event.type === "RunFailed",
      );
    if (!failure || reportedFailure.current !== null) return;
    reportedFailure.current = failure.seq;
    setSendFailed(true);
    const detail = failure.body["message"];
    const visible = typeof detail === "string" ? visibleChatText(detail) : "";
    const message =
      visible.length > 0
        ? humanFault(new Error(visible), wording.message.coordinatorStopped)
        : wording.message.coordinatorStopped;
    setSendFault(message);
    toast.error(message);
  }, [events, mirror]);

  for (const [at, parts] of committedSteps(liveRun, mirror))
    stepsByAt.current.set(at, parts);
  // What this session watched the coordinator do wins; a reply from before it has its saved calls.
  const coordinatorSteps = useSavedRunSteps(runTenantId, runId);
  const turns = useMemo(() => {
    const saved = savedTurnSteps(
      coordinatorSteps.steps,
      mirror.flatMap((turn) => (turn.role === "assistant" ? [turn.at] : [])),
    );
    return withPendingSends(mirror, sent).map((turn) => {
      if (turn.parts !== undefined || turn.role !== "assistant") return turn;
      const steps = stepsByAt.current.get(turn.at) ?? saved.get(turn.at);
      return steps === undefined
        ? turn
        : {
            ...turn,
            parts: [...steps, { kind: "text" as const, text: turn.text }],
          };
    });
    // The steps map only grows as the live run commits, which re-renders with a new mirror.
  }, [mirror, sent, coordinatorSteps.steps]);
  // What each of the coordinator's calls returned, saved or as this session watched it.
  const coordinatorResults = new Map([
    ...savedResults(coordinatorSteps.steps),
    ...liveRun.results,
  ]);
  const mailThreads = snapshot.conversation.threads;
  const specialistUpdates = useMemo(
    () => threadUpdates(mailThreads),
    [mailThreads],
  );
  const latestAssistant = [...mirror]
    .reverse()
    .find((turn) => turn.role === "assistant")?.text;
  const documentApprovals =
    waits === undefined ? undefined : documentApprovalsFrom(waits);
  const { settled: settledApprovals, settle } = useSettledApprovals(
    projectId,
    documentApprovals,
  );
  // A card decided here is already its settled line; the pending read lags behind it.
  const pendingFrom = (list: readonly Wait[]): OpenApproval[] =>
    documentApprovalsFrom(list).filter(
      (approval) =>
        !settledApprovals.some(
          (item) => item.approvalId === approval.approvalId,
        ),
    );
  const pendingApprovals = waits === undefined ? undefined : pendingFrom(waits);
  const shownApprovals =
    pendingApprovals === undefined
      ? settledApprovals
      : [...settledApprovals, ...pendingApprovals];
  const openApprovalIds = new Set(
    pendingApprovals?.map((approval) => approval.approvalId),
  );
  // Until the open decisions are read, no approval is known to hold the coordinator. An open
  // question holds it too, though its message run stays open while it waits.
  const parked =
    openQuestion !== undefined ||
    (waits !== undefined && parkedOnApproval(waits, openApprovalIds, runId));
  const liveTurn = pendingLiveTurn(liveRun, mirror);
  const streaming = liveTurnStreaming(liveRun, mirror, parked);
  const shownTurns =
    liveTurn === null
      ? turns
      : [
          ...turns,
          {
            role: "assistant" as const,
            text: liveTurn.text,
            at: -1,
            parts: liveTurn.parts,
            streaming,
          },
        ];
  const lastShown = shownTurns.at(-1);
  const replies =
    lastShown?.role === "assistant" && !streaming && !sending
      ? suggestedReplies(lastShown.text)
      : [];
  const agents = activity.data?.agents;
  const coordinator = agents?.find((agent) => agent.role === "coordinator");
  // Mid-turn by the hub's read: the coordinator's run began after the last end this stream saw.
  // The stream's own flag is not used; a frame missed while the tab is hidden leaves it set.
  const working =
    coordinator !== undefined &&
    (liveRun.endedAt === null ||
      Date.parse(coordinator.since) > liveRun.endedAt);
  // The engine treats the first id as history and every later change as a
  // send: it pins that turn and reserves space under it. A turn loaded from
  // the mirror is not a send. Passing it pins the old message and the reserve
  // grows without a bound.
  const sentId =
    sent.length === 0
      ? undefined
      : turns.reduce<string | undefined>((found, turn, index) => {
          return turn.role === "person" ? turnItemId(turn, index) : found;
        }, undefined);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const retryDocument = async (item: ProjectArtifact) => {
    const key = documentKey(projectId, item);
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
    const key = documentKey(projectId, item);
    if (retryingKey === key) return { status: "loading" };
    return documents[key];
  };

  const notSent = "That message was not sent.";
  const mail = async (text: string) =>
    (await sendMessage(projectId, text)).message;
  // An answer lands in the run log, not the conversation, so it never shows as a sent message.
  const deliverAnswer = async (signalName: string, answer: QuestionAnswer) => {
    setSending(true);
    try {
      await answerQuestion(projectId, signalName, answer);
      setSentAnswers((sent) => new Map(sent).set(signalName, answer));
      reloadRef.current();
      onChanged();
    } finally {
      setSending(false);
    }
  };
  const deliverMail = async (
    body: string,
    clearComposer = false,
    post: (text: string) => Promise<ChatMessage> = mail,
  ): Promise<boolean> => {
    const text = body.trim();
    if (text.length === 0 || sending) return false;
    setSending(true);
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(Date.now());
    // The person's words show the moment they send; the receipt replaces this stand-in.
    const pending: SentMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: text,
      at: new Date().toISOString(),
      after: latestTurnAt(mirror),
    };
    setSent((previous) => [...previous, pending]);
    if (clearComposer) setValue("");
    try {
      const message = await post(text);
      setSent((previous) =>
        previous.map((item) =>
          item === pending ? { ...pending, ...message } : item,
        ),
      );
      reloadRef.current();
      onChanged();
      return true;
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      if (clearComposer)
        setValue((current) => (current === "" ? text : current));
      const message = await humanFaultWithCode(cause, notSent);
      setSendFailed(true);
      setSendFault(message);
      toast.error(message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const addFiles = (picked: ArrayLike<File>) => {
    if (limits === undefined) return;
    const { accepted: taken, rejected } = intake.add(picked);
    let total = files.reduce((sum, item) => sum + item.size, 0);
    const fitting = taken.filter((item) => {
      if (total + item.size > limits.maxTotalBytes) return false;
      total += item.size;
      return true;
    });
    const refused = rejected[0];
    if (refused !== undefined) setAttachFault(rejectionText(refused, limits));
    else if (fitting.length < taken.length)
      setAttachFault(wording.attach.tooLargeTotal(limits.maxTotalBytes));
    else setAttachFault(null);
    setFiles((current) => [...current, ...fitting]);
  };

  const deliverFiles = async (): Promise<boolean> => {
    if (sending) return false;
    const text = value.trim();
    const attached = files;
    setSending(true);
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(Date.now());
    setAttachFault(null);
    const pending: SentMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: text,
      at: new Date().toISOString(),
      after: latestTurnAt(mirror),
      files: attached.map((item) => ({
        kind: "file" as const,
        name: item.name,
        mediaType: item.mediaType,
      })),
    };
    setSent((previous) => [...previous, pending]);
    setValue("");
    setFiles([]);
    try {
      await attachMaterials(
        projectId,
        attached.flatMap((item) =>
          item.file === undefined ? [] : [item.file],
        ),
        text.length === 0 ? undefined : text,
      );
      // Without words the hub mails its own note naming the files, which the mirror shows.
      if (text.length === 0)
        setSent((previous) => previous.filter((item) => item !== pending));
      reloadRef.current();
      onChanged();
      return true;
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      setValue((current) => (current === "" ? text : current));
      setFiles(attached);
      setAttachFault(await attachFaultText(cause));
      return false;
    } finally {
      setSending(false);
    }
  };

  const addToComposer = (text: string) => {
    setValue((current) =>
      current.trim().length === 0 ? text : `${current.trimEnd()}\n\n${text}`,
    );
    composerRef.current?.focus();
  };
  const addToPrompt = (passage: PassageQuote) =>
    addToComposer(formatPassageQuote(passage));

  // A park created moments after `inference.done` can already stand on the hub before the next
  // room reload lands; read once on demand when the cached list shows no open ask.
  const readPendingApprovals = async (): Promise<
    readonly OpenApproval[] | undefined
  > => {
    if (pendingApprovals !== undefined && pendingApprovals.length > 0)
      return pendingApprovals;
    try {
      const fresh = await queryClient.fetchQuery(
        openDecisionsQuery(projectId, true),
      );
      return pendingFrom(fresh);
    } catch (cause) {
      // The cached list is still the best answer; the send that follows reports a hub that is down.
      console.warn("Open decisions could not be re-read.", cause);
      return pendingApprovals;
    }
  };
  const chooseDocument = (id: string) =>
    setDocumentChoice({ id, filedCount: filed.length });
  // An attached file taken back: its tab goes with the next room read, and the person hears so.
  const removeAttachment = (id: string) => {
    if (!id.startsWith(MATERIAL_TAB)) return;
    const artifactId = id.slice(MATERIAL_TAB.length);
    const item = paneDeliverables.find((entry) => entry.kind === id);
    void takeBack(artifactId, item?.title);
  };
  const takeBack = async (artifactId: string, title: string | undefined) => {
    try {
      const removed = await removeMaterial(projectId, artifactId);
      setDocumentChoice(null);
      toast.success(
        wording.removeAttachment.done(
          title === undefined ? removed.title : title,
          removed.told,
        ),
      );
      reloadRef.current();
      onChanged();
    } catch (cause) {
      toast.error(humanFault(cause, wording.removeAttachment.failed));
    }
  };
  // The person approves the document they read; the next room read shows it approved.
  const approveRead = async (id: string, version: number) => {
    const item = paneDeliverables.find((entry) => entry.kind === id);
    if (item === undefined) return;
    try {
      await approveDocument(projectId, item.artifactId, version);
      reloadRef.current();
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
  const openDocument = (id: string) => {
    openProject(id);
    if (conceptOfTab(id) === undefined) chooseDocument(id);
  };
  // "settled" is a 409: someone already decided the ask, or its run moved on; the page reads
  // where it stands.
  const saveDecision = async (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
    message?: string;
  }): Promise<"saved" | "settled" | { fault: string }> => {
    const notSaved = { fault: "That decision was not saved." };
    const cachedWaits = queryClient.getQueryData<readonly Wait[]>(
      keys.openDecisions.of(projectId),
    );
    const wait =
      waits?.find((item) => item.approvalId === decision.approvalId) ??
      cachedWaits?.find((item) => item.approvalId === decision.approvalId);
    const approvalId = wait?.approvalId;
    const tenantId = wait?.tenantId;
    if (
      wait === undefined ||
      approvalId === undefined ||
      tenantId === undefined ||
      approvalBusy
    )
      return notSaved;
    setApprovalBusy(true);
    setApprovalError(null);
    const decided =
      documentApprovals?.find((item) => item.approvalId === approvalId) ??
      (cachedWaits === undefined
        ? undefined
        : documentApprovalsFrom(cachedWaits).find(
            (item) => item.approvalId === approvalId,
          ));
    try {
      await decideApproval({
        tenantId,
        approvalId,
        decision:
          decision.choice === "yes" || decision.choice === "always"
            ? "approve"
            : "reject",
        ...(decision.choice === "always" ? { scope: "always" as const } : {}),
        ...(decision.message === undefined
          ? {}
          : { message: decision.message }),
      });
      if (decided !== undefined)
        settle(decided, {
          status:
            decision.choice === "yes" || decision.choice === "always"
              ? "approved"
              : "rejected",
          ...(decision.choice === "always" ? { scope: "always" } : {}),
        });
      setGateDone((value) => value + 1);
      onChanged();
      return "saved";
    } catch (cause: unknown) {
      if (cause instanceof ProductApiError && cause.response.status === 409) {
        setGateDone((value) => value + 1);
        onChanged();
        return "settled";
      }
      const fault = await humanFaultWithCode(cause, notSaved.fault);
      setApprovalError(fault);
      return { fault };
    } finally {
      setApprovalBusy(false);
    }
  };
  // Resolves to the fault the person sees, or null once the decision stands.
  const onDecideApproval = async (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }): Promise<string | null> => {
    const saved = await saveDecision(decision);
    return typeof saved === "object" ? saved.fault : null;
  };
  // The person's words go with the decline as their reason; mailed instead when the ask could
  // not take them, so they are never lost and a failed mail says why.
  const declineWith =
    (approvalId: string) =>
    async (text: string): Promise<ChatMessage> => {
      const saved = await saveDecision({
        approvalId,
        choice: "no",
        message: deliveredText(text),
      });
      if (saved === "settled") return mail(text);
      if (typeof saved === "object") {
        // The composer reports the fault; the card keeps no second copy of it.
        setApprovalError(null);
        throw new Error(saved.fault);
      }
      return {
        id: `declined:${approvalId}`,
        author: "me",
        body: text,
        at: new Date().toISOString(),
      };
    };
  const openApproval = pendingApprovals?.find(
    (approval) => approval.packages === undefined,
  );
  // The message names the pick. Resolves to the fault the person sees, or null once it is sent.
  const chooseApproach = async (message: string): Promise<string | null> => {
    const currentApprovals = await readPendingApprovals();
    const currentOpen = currentApprovals?.find(
      (approval) => approval.packages === undefined,
    );
    return chooseApproachWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      deliver: () => deliverMail(message),
      decline: (approvalId) =>
        deliverMail(message, false, declineWith(approvalId)),
      notSent: wording.approaches.notSent,
    });
  };
  const deliver = async (body: string, clearComposer = false) => {
    if (body.trim().length === 0 || sending) return false;
    // While the coordinator waits on its question, whatever the person types is their answer.
    if (openQuestion !== undefined) {
      try {
        await deliverAnswer(openQuestion.signalName, { reply: body.trim() });
      } catch (cause) {
        toast.error(await humanFaultWithCode(cause, notSent));
        return false;
      }
      if (clearComposer) setValue("");
      return true;
    }
    const currentApprovals = await readPendingApprovals();
    const currentOpen = currentApprovals?.find(
      (approval) => approval.packages === undefined,
    );
    return deliverWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      decide: onDecideApproval,
      deliver: () => deliverMail(body, clearComposer),
      decline: (approvalId) =>
        deliverMail(body, clearComposer, declineWith(approvalId)),
    });
  };
  const sendFiles = async () => {
    if (sending) return false;
    const currentApprovals = await readPendingApprovals();
    const currentOpen = currentApprovals?.find(
      (approval) => approval.packages === undefined,
    );
    return deliverWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      decide: onDecideApproval,
      deliver: deliverFiles,
    });
  };
  const sendNow = () => {
    setCaution(null);
    void deliver(value, true);
  };
  const restoreToComposer = (message: string) =>
    setValue((current) => (current.trim().length === 0 ? message : current));
  const undoTypedYes = async (message: string) => {
    if (!(await deliver(message))) restoreToComposer(message);
  };
  const typedYes = useTypedYes({
    pending: pendingApprovals?.map((approval) => approval.approvalId),
    onApprove: (approvalId) =>
      void onDecideApproval({ approvalId, choice: "yes" }),
    onUndo: (message) => void undoTypedYes(message),
    onDropped: restoreToComposer,
  });
  const sendThroughPage = async () => {
    const staged = pageSend.current;
    if (staged === null || sending) return;
    const message = value.trim();
    if (await staged(message.length === 0 ? undefined : message)) setValue("");
  };
  // A change to a document a specialist is already building from waits for one more yes.
  const send = () => {
    if (pageQuestion !== undefined && pageSend.current !== null)
      return void sendThroughPage();
    if (files.length > 0) return void sendFiles();
    if (typedYes.hold(value)) return setValue("");
    // Without a read of who is at work there is no one to warn about.
    const role =
      rolesAtWork === undefined
        ? undefined
        : earlierDocumentRole(value, artifacts, rolesAtWork);
    if (role === undefined || caution === role) return sendNow();
    setCaution(role);
  };
  // The composer is disabled while the decline saves, so the cursor goes there once it can take it.
  const [changesAsked, setChangesAsked] = useState(false);
  const requestChanges = () => {
    setChangesAsked(true);
  };
  const unbound = events === null;
  const composerWaits = sending || approvalBusy || unbound;
  const composerDisabled = composerWaits || providerMissing;
  useEffect(() => {
    if (!changesAsked || composerDisabled) return;
    setChangesAsked(false);
    composerRef.current?.focus();
  }, [changesAsked, composerDisabled]);

  // A project that has talked before is between coordinators (an upgrade, a reopen): its thread
  // stays and reads as the coordinator at work, not as a project starting from nothing.
  const between =
    unbound && mirror.length > 0 && startFault === null && modelNeeded === null;
  const awaitingBind =
    status === "active" &&
    unbound &&
    startFault === null &&
    modelNeeded === null;
  useEffect(() => {
    if (!awaitingBind) return;
    const timer = setInterval(() => reloadRef.current(), BIND_POLL_MS);
    const fallback = setTimeout(() => void startCoordinator(), BIND_WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(fallback);
    };
  }, [awaitingBind]);
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
  const held =
    openQuestion !== undefined ||
    (waits !== undefined &&
      waitingOnPerson(waits, openApprovalIds, runId, liveRun.running));
  const awaiting =
    awaitingReply(awaitingSince, turns.at(-1)?.role, liveRun.endedAt, parked) &&
    !archived &&
    startFault === null &&
    modelNeeded === null;
  // The mark stays for the whole turn: between model calls and during long tool work the live
  // reply shows nothing moving.
  const thinking =
    !sendFailed && (sending || awaiting || (working && !held) || between);
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
  const designDraft = useDesignDraft(
    projectId,
    designDraftFiled(
      artifacts.some((item) => item.kind === "design"),
      snapshot.inFlight,
    ),
  );
  const inFlight = snapshot.inFlight;
  const dispatches = shownTurns.flatMap((turn) =>
    turn.role === "assistant" && turn.parts !== undefined
      ? partsDispatches(turn.parts, coordinatorResults)
      : [],
  );
  // A run with no hand-off in this session's view, such as after a reload, still gets its card.
  for (const run of inFlight)
    if (!runCards.current.has(run.runId)) runCards.current.set(run.runId, run);
  const unseenRuns = [...runCards.current.values()]
    .filter(
      (run) =>
        !dispatches.some((dispatch) =>
          dispatch.runId === undefined
            ? dispatch.role === run.role
            : dispatch.runId === run.runId,
        ),
    )
    .map((run) => ({
      at: Date.parse(run.startedAt),
      dispatch: runDispatch(run),
    }));
  // Each run at work streams its steps and what it is producing into its card; past a handful, the
  // newest only. Every card with a run loads the steps that run saved before this page saw it.
  const {
    previews,
    steps: runSteps,
    results: runResults,
    ended: runsEnded,
  } = useRunStreams(
    runTenantId,
    inFlight
      .filter((run) => run.state === "working")
      .toSorted((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, STREAMED_RUNS)
      .map((run) => run.runId),
    [...dispatches, ...unseenRuns.map(({ dispatch }) => dispatch)].flatMap(
      (dispatch) => (dispatch.runId === undefined ? [] : [dispatch.runId]),
    ),
  );
  // A run no longer at work has saved how it ended, which the first read of its steps predates.
  const atWork = inFlight.map((run) => run.runId).join("\n");
  const wasAtWork = useRef<readonly string[]>([]);
  useEffect(() => {
    const now = atWork.split("\n");
    if (runTenantId !== undefined)
      for (const left of wasAtWork.current)
        if (!now.includes(left))
          void queryClient.invalidateQueries({
            queryKey: keys.runSteps(runTenantId, left),
          });
    wasAtWork.current = now;
  }, [atWork, runTenantId]);
  const dispatchRoom: DispatchRoom = {
    artifacts: snapshot.artifacts,
    inFlight,
    failed: snapshot.failed,
    seen: dispatchSeen.current,
    previews,
    steps: runSteps,
    ended: new Map([
      ...runsEnded,
      ...[...stoppedHere].map((stopped): [string, RunEnd] => [
        stopped,
        { status: "cancelled" },
      ]),
    ]),
    onOpenDocument: (kind) => {
      // A coder files the app's source, which is read as the running app.
      if (kind === "app") return openProject(LIVE_TAB);
      openDocument(
        kind.startsWith("concept:") ? conceptTab(kind.slice(8)) : kind,
      );
    },
    onWatch: (dispatch) => {
      if (dispatch.role === "coder") return openProject(LIVE_TAB);
      openProject(
        dispatch.concept === undefined
          ? DRAFT_TAB
          : conceptTab(dispatch.concept),
      );
    },
    onStop: async (stopped) => {
      try {
        await stopRun(projectId, stopped);
        setStoppedHere((before) => new Set(before).add(stopped));
        reloadRef.current();
      } catch (cause) {
        toast.error(humanFault(cause, wording.dispatch.notStopped));
      }
    },
  };
  for (const dispatch of dispatches) noteDispatch(dispatchRoom, dispatch);
  for (const { dispatch } of unseenRuns) noteDispatch(dispatchRoom, dispatch);
  const cards = filedDispatches(dispatchRoom, dispatches, unseenRuns);
  const design = artifacts.find((item) => item.kind === "design");
  // The design a review screen shows: the live draft while a designer works, else the newest design
  // option, else the filed design. Only an option is approved there: the hub records the choice
  // from the answer.
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
  const reviewApproval = (
    item: ProjectArtifact,
  ): ReviewedDesign["approval"] => {
    if (item.kind === DESIGN_OPTION) return { option: item.artifactId };
    return {
      unavailable:
        item.approvedVersion === item.version
          ? wording.designReview.approved
          : wording.designReview.noOption,
    };
  };
  const reviewedDesign = (): ReviewedDesign | null => {
    if (designDraft !== null)
      return {
        files: designDraft,
        version: "draft",
        approval: { unavailable: wording.designReview.draftNotApprovable },
      };
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
          inFlight,
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
  const choosable = concepts.some((concept) => concept.chosen)
    ? []
    : concepts.filter((concept) => concept.option !== undefined);
  // Each filed concept's bundle, parsed once per version it is filed at rather than on every
  // render of the room; the key names exactly the contents parsed.
  const choosableKey = choosable
    .map(
      ({ option }) => `${option?.artifactId ?? ""}@${String(option?.version)}`,
    )
    .join("\n");
  const choosableFiles = useMemo(
    () => choosable.map((concept) => parseBundle(concept.content ?? "")),
    [choosableKey],
  );
  const choosableConcepts = (): ChoosableConcept[] =>
    choosable.flatMap((concept, index) => {
      const files = choosableFiles[index];
      const filed = options.find(
        (option) => option.artifactId === concept.option?.artifactId,
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
    mockupFrame: MockupFrame,
    // The last round's answer on the same screen, so the person sees what they asked for before.
    earlierAnswer:
      pageQuestion === undefined
        ? undefined
        : questions
            .flatMap(({ signalName, asked, answer }) =>
              signalName !== pageQuestion.signalName &&
              "plugin" in asked &&
              asked.plugin === pageQuestion.asked.plugin &&
              asked.action === pageQuestion.asked.action &&
              answer !== undefined &&
              "output" in answer
                ? [answer.output]
                : [],
            )
            .at(-1),
    documents: {
      list: artifacts.map((item) =>
        shownDocument(item, documents[documentKey(projectId, item)]),
      ),
      open: openDocument,
    },
  };
  const pageHost: PageHost = {
    stage: (staged) => {
      pageSend.current = staged;
    },
    sendStaged: () => void sendThroughPage(),
    close: () => setClosedPage(pageQuestion?.signalName ?? null),
  };
  const appFiled = snapshot.artifacts.some((item) => item.kind === "app");
  const firstBuilder = appFiled
    ? undefined
    : inFlight.find((run) => run.role === "coder");
  // There is an app to preview once one is filed, built here or imported, or a coder is building
  // it; a filed build plan shows where it will appear.
  const appComing =
    appFiled ||
    firstBuilder !== undefined ||
    paneDeliverables.some((item) => item.kind === "build_plan");
  // Code that started from anything but the web app starter, such as a command-line tool, serves
  // nothing to preview. A project that never recorded its starter is a web app.
  const starter = useQuery({
    queryKey: keys.projectValues.starter(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: firstBuilder === undefined ? false : STARTER_POLL_MS,
    queryFn: appComing
      ? ({ signal }) => readProjectValues(projectId, [STARTER_VALUE], signal)
      : skipToken,
  });
  const started = starter.data?.[STARTER_VALUE];
  const servesApp = typeof started !== "string" || started === "web-app";
  const liveApp =
    appComing && servesApp ? { projectId, builder: firstBuilder } : null;
  // The manual follows the app, so it is read again while the coder works.
  const userManual = useUserManual(
    projectId,
    liveApp !== null,
    rolesAtWork?.has("coder") === true,
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

  // Until the first document is filed, drafted or there is an app, the project view has nothing to show.
  const nothingYet =
    paneDeliverables.length === 0 &&
    designDraft === null &&
    concepts.length === 0 &&
    liveApp === null;
  const dock = (): RoomDock => {
    if (archived)
      return {
        kind: "archived",
        restoring,
        fault: restoreFault,
        onRestore: () => void restore(),
      };
    // A coordinator with no model to run on cannot answer, even one still bound from before.
    if (modelNeeded !== null && !providerMissing)
      return {
        kind: "modelNeeded",
        message: modelNeeded.message,
        onOpenSettings,
        onRetry: () => void startCoordinator(),
      };
    // The person does not start the coordinator by typing: an unbound room waits for the
    // start that opening it asked for, and a refused start says why and offers it again.
    if (unbound && !providerMissing && !between) {
      if (startFault === null) return { kind: "starting" };
      return {
        kind: "startFailed",
        message: startFault,
        onRetry: () => void startCoordinator(),
      };
    }
    return {
      kind: "composer",
      text: value,
      onTextChange: setValue,
      onSend: send,
      placeholder: composerPlaceholder({
        approvalOpen: openApproval !== undefined,
        questionsOpen: openQuestion !== undefined,
        status: projectStatus.data,
        nothingFiled: nothingYet,
      }),
      inputRef: composerRef,
      working: working || sending,
      busy: sending || approvalBusy,
      disabled: composerWaits,
      needsProvider: providerMissing,
      onEnableAi: () => setEnablingAi(true),
      attachments: {
        files,
        accept:
          limits === undefined || limits.mimeTypes.length === 0
            ? null
            : limits.mimeTypes.join(","),
        fault: attachFault,
        onAdd: addFiles,
        onRemove: (id) =>
          setFiles((current) => current.filter((held) => held.id !== id)),
      },
      sendFault: sendFailed && sendFault ? sendFault : null,
      caution: caution === null ? null : participantLabel(caution),
      onSendAnyway: sendNow,
      onCancelCaution: () => {
        setCaution(null);
        composerRef.current?.focus();
      },
      suggestedReplies: replies,
      onReply: (reply) => void deliver(reply),
    };
  };
  const answerCard = async (signalName: string, answer: QuestionAnswer) => {
    try {
      await deliverAnswer(signalName, answer);
      return true;
    } catch (cause) {
      // The card tells the person and keeps their picks to try again.
      console.warn("The answers were not sent.", cause);
      return false;
    }
  };
  const emptyConversation = () => {
    if (archived) return "archived";
    return shownTurns.length === 0 && !thinking ? "new" : null;
  };

  return {
    view: {
      title: projectTitle,
      layout: {
        projectReady: !nothingYet,
        projectOpen,
        onProjectOpenChange: setProjectOpen,
        pageOpen,
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
          approvals: shownApprovals,
          results: new Map([...coordinatorResults, ...runResults]),
          runs: cards,
          live: (dispatch) => dispatchLive(dispatch, dispatchRoom),
          standing: (unit) => workUnitStanding(unit, dispatchRoom),
          onDecide: onDecideApproval,
          onRequestChanges: requestChanges,
          approvalDisabled: approvalBusy || archived,
          ...(approvalError === null ? {} : { approvalError }),
          ...(typedYes.held === null
            ? {}
            : {
                typedYes: {
                  held: typedYes.held,
                  onUndo: typedYes.undo,
                },
              }),
          ...(sentId === undefined ? {} : { sentId }),
          questions: [...snapshot.conversation.earlierQuestions, ...questions],
          onAnswerQuestion: answerCard,
          questionsDisabled: sending || archived,
          projectValues,
          screenOf,
          screenSupplies: supplies,
          onOpenPageScreen: () => setClosedPage(null),
        },
        empty: emptyConversation(),
      },
      dock: dock(),
      plan: snapshot.plan,
      onDeclineStep: async (stepId, declined) => {
        try {
          await (declined ? declinePlanStep : restorePlanStep)(
            projectId,
            stepId,
          );
          reloadRef.current();
        } catch (cause) {
          toast.error(humanFault(cause, wording.conversation.plan.notChanged));
        }
      },
      onGoAheadStep: async (stepId) => {
        try {
          await goAheadPlanStep(projectId, stepId);
          reloadRef.current();
        } catch (cause) {
          toast.error(humanFault(cause, wording.conversation.plan.notChanged));
        }
      },
      onAskFirstStep: async (stepId, askFirst) => {
        try {
          await setPlanStepAskFirst(projectId, stepId, askFirst);
          reloadRef.current();
        } catch (cause) {
          toast.error(humanFault(cause, wording.conversation.plan.notChanged));
        }
      },
      documentPane: {
        projectId,
        projectTitle,
        draft: designDraft,
        manual: userManual,
        concepts,
        openTab: paneTab,
        documents: paneDeliverables.map((item) => paneDocument(item, seen)),
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
        onRemove: removeAttachment,
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
              onDeliverMessage: (message: string) => deliver(message),
              onApprove: approveRead,
            }),
      },
      paneRef: documentPaneRef,
    },
    nextStep: archived
      ? null
      : {
          projectId,
          actions: {
            reply: requestChanges,
            resume_coordinator: () => void startCoordinator(),
            ...(liveApp === null
              ? {}
              : {
                  open_app: () => openProject(LIVE_TAB),
                }),
          },
        },
    enableAi: { open: enablingAi, onOpenChange: setEnablingAi },
    liveApp,
    pageScreen:
      pageQuestion === undefined
        ? null
        : {
            host: screenOf(pageQuestion.asked)?.host,
            input: pageQuestion.asked.input,
            projectValues,
            answer: undefined,
            disabled: sending || archived,
            onAnswer: (answer) => answerCard(pageQuestion.signalName, answer),
            supplies,
            page: pageHost,
          },
  };
}
