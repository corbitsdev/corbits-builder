/**
 * The project room.
 *
 * One conversation with the coordinator. The transcript is the durable
 * mirror's committed person and assistant text, drawn through MessageParts.
 * While a message run is in progress, text, thinking, and tool frames from
 * the run's SSE stream show in the log as one live turn; each call's part is
 * replaced when the mirror commits that text. The stream also says when to
 * read the room again; a slow fallback read covers what it cannot see.
 * Outputs have a persistent reading pane beside the conversation, without
 * making chat inert during document review.
 */
import { wording } from "../../config.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import {
  Attachment,
  type AttachmentItem,
  type AttachmentRejection,
  AttachmentDropZone,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  Button as UiButton,
  ConversationEmptyState,
  type ConversationPart,
  PromptInput,
  PromptInputButton,
  PromptInputFloat,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  useAttachments,
} from "@corbits/react-ui";
import { useProjectActivity, useRolesAtWork } from "./agent-activity.tsx";
import {
  dispatchLive,
  DispatchRoomContext,
  noteDispatch,
  partsDispatches,
  runDispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { earlierDocumentRole } from "./earlier-document.ts";
import { ArtifactPane, LIVE_TAB } from "./artifact-pane.tsx";
import "./persistent-workspace.css";
import { ProductApiError, type ProjectArtifact } from "@corbits-builder/client";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { toast } from "sonner";
import type { ConversationTurn } from "../../api/conversation.ts";
import { subscribeWorkflowRun } from "../../api/run-stream.ts";
import { workspaceTenantId } from "../../api/auth.ts";
import {
  acceptedMaterials,
  attachMaterials,
  readArtifact,
} from "../../api/artifacts.ts";
import { documentsForPane } from "./document-read.ts";
import { api } from "../../client.ts";
import {
  getProject,
  restoreProject,
  startProjectCoordinator,
} from "../../api/projects.ts";
import type { ChatMessage, Wait } from "../../api/types.ts";
import { keys } from "../../queries/keys.ts";
import { COMPOSER_BOX_CLASS, CONV_CLASS, PANES_CLASS } from "./pane-classes.ts";
import { RoomThread, turnItemId, type TranscriptTurn } from "./transcript.tsx";
import { cardDocuments } from "./collaboration.ts";
import { useFiledVersions } from "./filed-versions.tsx";
import { threadUpdates } from "./specialist-updates.tsx";
import { useSettledApprovals, type OpenApproval } from "./settled-approvals.ts";
import { useTypedYes } from "./typed-yes.tsx";
import { asksAbout, chosenApproach } from "./approach-choice.ts";
import { selectedDeliverable } from "./reading-selection.ts";
import {
  followDeliverableId,
  shownDeliverableId,
  type DocumentChoice,
} from "./tab-follow.ts";
import {
  awaitingCommit,
  committedSteps,
  emptyLiveRun,
  foldLiveRun,
  latestAssistantAt,
  pendingLiveTurn,
  waitingOnPerson,
  type LiveRun,
} from "./live-run.ts";
import { createRoomReloader } from "./room-reload.ts";
import { decideApproval } from "../../api/decisions.ts";
import type { DeliverableState } from "./deliverable-block.tsx";
import { formatPassageQuote, type PassageQuote } from "./passage-note.tsx";
import { DesignTarget } from "./mockup-tweaks.tsx";
import { humanFault, humanFaultWithCode, responseCode } from "./human-fault.ts";
import { suggestedReplies } from "./suggested-replies.ts";
import { participantLabel, visibleChatText } from "./visible-chat.ts";
import {
  loadProjectRoom,
  reloadProjectDocument,
  roomDocumentKey,
  roomSnapshotReady,
} from "./load-room.ts";
import { RoomFault, RoomSkeleton } from "./room-skeleton.tsx";
import { useDesignDraft } from "./design-preview.tsx";
import {
  conceptOfTab,
  conceptTab,
  DesignChoice,
  DesignChosen,
  designConcepts,
  DESIGN_OPTION,
} from "./design-concepts.tsx";
import { useLiveAppPresence } from "./live-app.tsx";
import { NextStepLine } from "./next-step.tsx";
import { Dictated } from "../../dictation.jsx";
import { useShellReply } from "../../flourish.tsx";

// The stream says when the room moved. This read covers what it cannot see,
// such as a coordinator run replaced while its old stream stays quiet.
const FALLBACK_RELOAD_MS = 30_000;
// After a run closes, the mirror's commit can trail its last frame.
const SETTLE_RELOAD_MS = [1_000, 3_000, 7_000, 15_000];

export { selectedDeliverable };

function openingDraft(
  projectId: string,
  openingMessage: string | undefined,
): ChatMessage[] {
  const text = openingMessage?.trim() ?? "";
  if (text.length === 0) return [];
  return [
    {
      id: `opening:${projectId}`,
      author: "me",
      body: text,
      at: new Date(0).toISOString(),
    },
  ];
}

// A message's stand-in id until the hub's receipt replaces it.
const SENDING = "sending:";

function withPendingSends(
  mirror: readonly ConversationTurn[],
  sent: readonly ChatMessage[],
): TranscriptTurn[] {
  const pending = [...sent];
  const shown: TranscriptTurn[] = [];
  for (const turn of mirror) {
    const index = pending.findIndex(
      (message) =>
        message.body === turn.text &&
        (message.author === "agent") === (turn.role === "assistant"),
    );
    if (index >= 0) pending.splice(index, 1);
    shown.push(turn);
  }
  for (const message of pending) {
    const at = Date.parse(message.at);
    shown.push({
      role: message.author === "agent" ? "assistant" : "person",
      text: message.body,
      at: Number.isNaN(at) ? 0 : at,
      ...(message.id.startsWith(SENDING) ? { sending: true } : {}),
    });
  }
  return shown;
}

// The hand-offs that name the document their run works on, by the role they start.
const HANDOFF_ROLE: Record<string, InFlightRun["role"]> = {
  deploy_writer: "writer",
  review_artifact: "reviewer",
};

// The documents the coordinator waits for before design_app.
const DESIGN_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
];
// Every material shares one kind, but each file is its own tab, so the pane names it by its artifact.
const MATERIAL = "material";
const MATERIAL_TAB = `${MATERIAL}:`;
function paneArtifact(item: ProjectArtifact): ProjectArtifact {
  return item.kind === MATERIAL
    ? { ...item, kind: `${MATERIAL_TAB}${item.artifactId}` }
    : item;
}

function documentKey(projectId: string, item: ProjectArtifact): string {
  return roomDocumentKey(
    projectId,
    item.kind.startsWith(MATERIAL_TAB) ? { ...item, kind: MATERIAL } : item,
  );
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
async function modelRefusal(cause: unknown): Promise<string | undefined> {
  if (!(cause instanceof ProductApiError) || cause.response.status !== 409)
    return undefined;
  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);
  return body !== null &&
    typeof body === "object" &&
    "code" in body &&
    "message" in body &&
    typeof body.code === "string" &&
    MODEL_CHOICE_REFUSALS.has(body.code) &&
    typeof body.message === "string"
    ? body.message
    : undefined;
}

export function StageWorkspace({
  projectId,
  projectTitle,
  onChanged,
  onOpenSettings,
  openingMessage,
  listedArchived,
}: {
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
}) {
  // The conversation record comes from the room query. Null events means no
  // coordinator is bound yet (the hub's 409). Empty arrays are not a stand-in
  // for a read that has not happened.
  const queryClient = useQueryClient();
  // An archived project has no coordinator or conversation to read, so the room waits on its lifecycle.
  const lifecycle = useQuery({
    queryKey: keys.projectLifecycle.of(projectId),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async () => (await getProject(projectId)).status,
  });
  // A status restored from the saved cache may predate an archive, so only a read made since
  // opening counts. The project list learns of an archive first, so it wins while the read catches up.
  const status = listedArchived
    ? "archived"
    : lifecycle.isFetchedAfterMount
      ? lifecycle.data
      : undefined;
  const archived = status === "archived";
  const listedBefore = useRef(listedArchived);
  useEffect(() => {
    if (listedBefore.current === listedArchived) return;
    listedBefore.current = listedArchived;
    void lifecycle.refetch();
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
  const snapshot = status === undefined ? undefined : room.data;
  const events = snapshot?.conversation.events ?? null;
  const mirror = snapshot?.conversation.turns ?? [];
  const runId = archived ? null : (snapshot?.conversation.runId ?? null);
  // The coder's filed app source is the resume point for a later coder, not a document to read.
  const artifacts = (snapshot?.artifacts ?? [])
    .filter((item) => item.kind !== "app")
    .map(paneArtifact);
  const documents = snapshot?.documents ?? {};
  const [liveRun, setLiveRun] = useState<LiveRun>(emptyLiveRun);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [documentChoice, setDocumentChoice] = useState<DocumentChoice | null>(
    null,
  );
  const [paneTab, setPaneTab] = useState<{ value: string } | null>(null);
  // The design the person chose here, by the hub's receipt, and when, so the outcome keeps its place.
  const [designChoice, setDesignChoice] = useState<{
    concept: string;
    at: number;
  } | null>(null);
  const documentPaneRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Each committed reply's thinking and tool work, as this session watched it.
  const stepsByAt = useRef(new Map<number, readonly ConversationPart[]>());
  // When this session first saw each hand-off, so the document it files reads as its result.
  const dispatchSeen = useRef<DispatchRoom["seen"]>(new Map());
  const handoffCalls = useRef(
    new Map<string, { role: InFlightRun["role"]; kind: string; at: number }>(),
  );
  const runKinds = useRef(new Map<string, string>());
  const usedCalls = useRef(new Set<string>());
  // Every specialist run this session saw, so its card keeps its result after the run ends.
  const runCards = useRef(new Map<string, InFlightRun>());
  const [mobilePane, setMobilePane] = useState<"conversation" | "artifacts">(
    "conversation",
  );
  const [sent, setSent] = useState<ChatMessage[]>(() =>
    openingDraft(projectId, openingMessage),
  );
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [sendFault, setSendFault] = useState<string | null>(null);
  // When this session last sent the coordinator a message, until a run ends after it or it fails.
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const [startFault, setStartFault] = useState<string | null>(null);
  // Why the coordinator has no model to run on, which only the person can settle.
  const [modelNeeded, setModelNeeded] = useState<string | null>(null);
  const accepted = useQuery({
    queryKey: keys.acceptedMaterials.of(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => acceptedMaterials(projectId),
  });
  const limits = accepted.data;
  const [files, setFiles] = useState<readonly AttachmentItem[]>([]);
  const [attachFault, setAttachFault] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intake = useAttachments({
    attachments: files,
    ...(limits === undefined
      ? {}
      : { maxFiles: limits.maxFiles, maxFileBytes: limits.maxFileBytes }),
  });
  // The files each sent message carried, by its text, as this session sent them.
  const filesByText = useRef(new Map<string, readonly ConversationPart[]>());
  const liveRunRef = useRef<LiveRun>(emptyLiveRun);
  const committedAtRef = useRef<number | null>(null);
  committedAtRef.current = latestAssistantAt(mirror);
  const reportedFailure = useRef<number | null>(null);
  const [waits, setWaits] = useState<Wait[]>([]);
  const rolesAtWork = useRolesAtWork(projectId);
  const [caution, setCaution] = useState<string | null>(null);
  const [gateDone, setGateDone] = useState(0);
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (status === undefined) return;
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
    setChangesFor(null);
    setDocumentChoice(null);
    setPaneTab(null);
    setDesignChoice(null);
    setMobilePane("conversation");
    setSent(openingDraft(projectId, openingMessage));
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(null);
    setCaution(null);
    setFiles([]);
    setAttachFault(null);
    stepsByAt.current.clear();
    dispatchSeen.current.clear();
    handoffCalls.current.clear();
    runKinds.current.clear();
    usedCalls.current.clear();
    runCards.current.clear();
    filesByText.current.clear();
  }, [projectId, openingMessage]);

  // The durable mirror is the committed transcript. The stream fills the gap
  // while a message run is producing it, and says when to read the room
  // again. A dropped stream reads the room too: the coordinator run it named
  // may have been replaced, and a new run id resubscribes here.
  useEffect(() => {
    liveRunRef.current = emptyLiveRun;
    setLiveRun(emptyLiveRun);
    if (runId === null) return;
    let unsubscribe = () => {};
    let cancelled = false;
    const reload = () => reloadRef.current();
    void workspaceTenantId()
      .then((tenantId) => {
        if (cancelled) return;
        unsubscribe = subscribeWorkflowRun(tenantId, runId, {
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
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          toast.error(humanFault(cause, "Live updates are not available."), {
            id: "live-subscription",
          });
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId, runId]);

  // A room that moved may mean a message reached the coordinator from elsewhere; read who is at work.
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: keys.projectActivity.of(projectId),
    });
  }, [projectId, queryClient, snapshot]);

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

  // The waits that belong to this project, from the open decisions.
  useEffect(() => {
    let cancelled = false;
    void import("../../api/decisions.ts").then(({ openDecisions }) =>
      openDecisions()
        .then((all) => {
          if (!cancelled)
            setWaits(all.filter((wait) => wait.projectId === projectId));
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            toast.error(
              humanFault(cause, "Open decisions could not be read."),
              {
                id: "waits-read",
              },
            );
        }),
    );
    return () => {
      cancelled = true;
    };
    // A coordinator decision arrives with a room event; a coder's package
    // request raises none, so every room reload re-reads the open decisions.
  }, [projectId, gateDone, snapshot]);

  for (const [at, parts] of committedSteps(liveRun, mirror))
    stepsByAt.current.set(at, parts);
  const turns = useMemo(
    () =>
      withPendingSends(mirror, sent).map((turn) => {
        const attached =
          turn.role === "person"
            ? filesByText.current.get(turn.text)
            : undefined;
        if (attached !== undefined)
          return {
            ...turn,
            parts:
              turn.text.length === 0
                ? attached
                : [...attached, { kind: "text" as const, text: turn.text }],
          };
        const steps =
          turn.role === "assistant"
            ? stepsByAt.current.get(turn.at)
            : undefined;
        return steps === undefined
          ? turn
          : {
              ...turn,
              parts: [...steps, { kind: "text" as const, text: turn.text }],
            };
      }),
    // The steps map only grows as the live run commits, which re-renders with a new mirror.
    [mirror, sent],
  );
  const mailThreads = snapshot?.conversation.threads;
  const specialistUpdates = useMemo(
    () => threadUpdates(mailThreads ?? []),
    [mailThreads],
  );
  const latestAssistant =
    [...mirror].reverse().find((turn) => turn.role === "assistant")?.text ?? "";
  const liveTurn = pendingLiveTurn(liveRun, mirror);
  const streaming = liveTurn !== null && !liveRun.ended;
  const liveText = liveTurn?.text ?? "";
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
  // Mid-turn by native state, whoever sent the message: this stream saw the message run start and
  // not end, or the hub's activity read saw one start after the last end this stream saw.
  const agents = useProjectActivity(projectId).data?.agents ?? [];
  const coordinatorTurnSince = agents.find(
    (agent) => agent.role === "coordinator",
  )?.since;
  const working =
    liveRun.running ||
    (coordinatorTurnSince !== undefined &&
      Date.parse(coordinatorTurnSince) > (liveRun.endedAt ?? 0));
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
  const retryDocument = (item: ProjectArtifact) => {
    const key = documentKey(projectId, item);
    if (documents[key]?.status !== "error") return;
    setRetryingKey(key);
    void reloadProjectDocument(projectId, key, queryClient, !archived).finally(
      () => {
        setRetryingKey((current) => (current === key ? null : current));
      },
    );
  };
  const documentState = (
    item: ProjectArtifact,
  ): DeliverableState | undefined => {
    const key = documentKey(projectId, item);
    if (retryingKey === key) return { status: "loading" };
    return documents[key];
  };

  const deliver = async (
    body: string,
    clearComposer = false,
  ): Promise<boolean> => {
    const text = body.trim();
    if (text.length === 0 || sending) return false;
    setSending(true);
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(Date.now());
    // The person's words show the moment they send; the receipt replaces this stand-in.
    const pending: ChatMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: text,
      at: new Date().toISOString(),
    };
    setSent((previous) => [
      ...previous.filter((item) => item.author !== "me" || item.body !== text),
      pending,
    ]);
    if (clearComposer) setValue("");
    try {
      // The api layer, not the raw adapter: an unbound project gets the
      // deploy-and-bind prelude before the send lands.
      const { message, receipt } = await api.sendMessage(projectId, text);
      setSent((previous) =>
        previous.map((item) => (item === pending ? message : item)),
      );
      void receipt;
      reloadRef.current();
      onChanged();
      return true;
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      if (clearComposer)
        setValue((current) => (current === "" ? text : current));
      const message = await humanFaultWithCode(
        cause,
        "That message was not sent.",
      );
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
    setAttachFault(
      refused !== undefined
        ? rejectionText(refused, limits)
        : fitting.length < taken.length
          ? wording.attach.tooLargeTotal(limits.maxTotalBytes)
          : null,
    );
    setFiles((current) => [...current, ...fitting]);
  };

  const sendFiles = async () => {
    if (sending) return;
    const text = value.trim();
    const attached = files;
    setSending(true);
    setSendFailed(false);
    setSendFault(null);
    setAwaitingSince(Date.now());
    setAttachFault(null);
    filesByText.current.set(
      text,
      attached.map((item) => ({
        kind: "file" as const,
        name: item.name,
        mediaType: item.mediaType,
      })),
    );
    const pending: ChatMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: text,
      at: new Date().toISOString(),
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
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      filesByText.current.delete(text);
      setValue((current) => (current === "" ? text : current));
      setFiles(attached);
      setAttachFault(await attachFaultText(cause));
    } finally {
      setSending(false);
    }
  };

  const addToComposer = (text: string) => {
    setValue((current) =>
      current.trim().length === 0 ? text : `${current.trimEnd()}\n\n${text}`,
    );
    setMobilePane("conversation");
    composerRef.current?.focus();
  };
  const addToPrompt = (passage: PassageQuote) =>
    addToComposer(formatPassageQuote(passage));

  const documentApprovals = waits.flatMap((wait): OpenApproval[] => {
    if (wait.approvalId === undefined || wait.tenantId === undefined) return [];
    const at =
      wait.createdAt === undefined ? Number.NaN : Date.parse(wait.createdAt);
    return [
      {
        approvalId: wait.approvalId,
        tenantId: wait.tenantId,
        ...(Number.isNaN(at) ? {} : { at }),
        ...cardDocuments(wait, artifacts),
        ...(wait.toolName === undefined ? {} : { toolName: wait.toolName }),
        ...(wait.kinds === undefined ? {} : { kinds: wait.kinds }),
        ...(wait.instruction === undefined
          ? {}
          : { instruction: wait.instruction }),
        ...(wait.subject === undefined ? {} : { subject: wait.subject }),
        ...(wait.packages === undefined ? {} : { packages: wait.packages }),
        ...(wait.concepts === undefined ? {} : { concepts: wait.concepts }),
      },
    ];
  });
  const { settled: settledApprovals, settle } = useSettledApprovals(
    projectId,
    documentApprovals,
    artifacts,
  );
  // A card decided here is already its settled line; the pending read lags behind it.
  const pendingApprovals = documentApprovals.filter(
    (approval) =>
      !settledApprovals.some((item) => item.approvalId === approval.approvalId),
  );
  const chooseDocument = (id: string) =>
    setDocumentChoice({ id, filedCount: filed.length });
  const openDocument = (id: string) => {
    setPaneTab({ value: id });
    if (conceptOfTab(id) === undefined) chooseDocument(id);
    setMobilePane("artifacts");
    queueMicrotask(() => documentPaneRef.current?.focus());
  };
  // Resolves to the fault the person sees, or null once the decision stands.
  const onDecideApproval = async (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }): Promise<string | null> => {
    const notSaved = "That decision was not saved.";
    const wait = waits.find((item) => item.approvalId === decision.approvalId);
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
    const decided = documentApprovals.find(
      (item) => item.approvalId === approvalId,
    );
    try {
      await decideApproval({
        tenantId,
        approvalId,
        decision:
          decision.choice === "yes" || decision.choice === "always"
            ? "approve"
            : "reject",
        ...(decision.choice === "always" ? { scope: "always" as const } : {}),
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
      return null;
    } catch (cause: unknown) {
      // 409: someone already decided it (another tab or collaborator); show where it stands.
      if (cause instanceof ProductApiError && cause.response.status === 409) {
        setGateDone((value) => value + 1);
        onChanged();
        return null;
      }
      const fault = await humanFaultWithCode(cause, notSaved);
      setApprovalError(fault);
      return fault;
    } finally {
      setApprovalBusy(false);
    }
  };
  // Choosing an approach is the person's yes to the version's open ask; the message names the pick.
  const chooseApproach = async (
    message: string,
    version: number,
  ): Promise<string | null> => {
    const kind = selected?.kind;
    const asked =
      kind === undefined
        ? undefined
        : pendingApprovals.find(
            (approval) =>
              approval.packages === undefined &&
              asksAbout(approval, kind, version),
          );
    if (asked !== undefined) {
      const fault = await onDecideApproval({
        approvalId: asked.approvalId,
        choice: "yes",
      });
      if (fault !== null) return fault;
    }
    return (await deliver(message)) ? null : wording.approaches.notSent;
  };
  const openApproval = pendingApprovals.find(
    (approval) => approval.packages === undefined,
  );
  const sendNow = () => {
    setCaution(null);
    void deliver(value, true);
  };
  const restoreToComposer = (message: string) =>
    setValue((current) => (current.trim().length === 0 ? message : current));
  const typedYes = useTypedYes({
    pending: pendingApprovals.map((approval) => approval.approvalId),
    onApprove: (approvalId) =>
      void onDecideApproval({ approvalId, choice: "yes" }),
    onUndo: (message) =>
      void deliver(message).then((sent) => {
        if (!sent) restoreToComposer(message);
      }),
    onDropped: restoreToComposer,
  });
  const shell = useShellReply(documentPaneRef);
  // A change to a document a specialist is already building from waits for one more yes.
  const send = () => {
    if (files.length > 0) return void sendFiles();
    if (shell.answers(value)) return setValue("");
    if (typedYes.hold(value)) return setValue("");
    const role = earlierDocumentRole(value, artifacts, rolesAtWork);
    if (role === undefined || caution === role) return sendNow();
    setCaution(role);
  };
  const requestChanges = () => {
    setMobilePane("conversation");
    composerRef.current?.focus();
  };

  const unbound = snapshot !== undefined && events === null;
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
  const [restoring, setRestoring] = useState(false);
  const [restoreFault, setRestoreFault] = useState<string | null>(null);
  const restore = async () => {
    setRestoring(true);
    setRestoreFault(null);
    try {
      await restoreProject(projectId);
      await lifecycle.refetch();
      onChanged();
    } catch (cause) {
      setRestoreFault(
        await humanFaultWithCode(cause, wording.archivedProject.restoreFailed),
      );
    } finally {
      setRestoring(false);
    }
  };
  const held = waitingOnPerson(
    waits,
    new Set(pendingApprovals.map((approval) => approval.approvalId)),
    runId,
    liveRun.running,
  );
  // A message sent here waits on the coordinator from the moment it leaves, before the stream
  // reports its run: until a reply follows it or a run ends after it.
  const awaitingReply =
    awaitingSince !== null &&
    turns.at(-1)?.role === "person" &&
    (liveRun.endedAt === null || liveRun.endedAt < awaitingSince) &&
    !archived &&
    startFault === null &&
    modelNeeded === null;
  // The mark stays for the whole turn: between model calls and during long tool work the live
  // reply shows nothing moving.
  const thinking =
    !sendFailed && (sending || awaitingReply || (working && !held));
  // Each concept's option is its own tab beside the others, never an ordinary document.
  const options = artifacts.filter((item) => item.kind === DESIGN_OPTION);
  const paneDeliverables = documentsForPane(
    artifacts.filter((item) => item.kind !== DESIGN_OPTION),
    documentState,
  );
  const designDraft = useDesignDraft(
    projectId,
    artifacts.some((item) => item.kind === "design"),
  );
  const inFlight = snapshot?.inFlight ?? [];
  const dispatchRoom: DispatchRoom = {
    artifacts: snapshot?.artifacts ?? [],
    inFlight,
    failed: snapshot?.failed ?? [],
    seen: dispatchSeen.current,
    approvals: [...settledApprovals, ...pendingApprovals],
    activity: agents,
    onOpenDocument: (kind) =>
      openDocument(
        kind.startsWith("concept:") ? conceptTab(kind.slice(8)) : kind,
      ),
  };
  const dispatches = shownTurns.flatMap((turn) =>
    turn.role === "assistant"
      ? partsDispatches(turn.parts ?? [], liveRun.results)
      : [],
  );
  for (const dispatch of dispatches) noteDispatch(dispatchRoom, dispatch);
  // The document a writer or reviewer run works on, from the coordinator's own hand-off call as
  // the hub's activity read saw it start: the latest such call made before the run started.
  for (const tool of agents.find((agent) => agent.role === "coordinator")
    ?.tools ?? []) {
    const role = HANDOFF_ROLE[tool.name];
    if (role !== undefined && tool.subject !== undefined)
      handoffCalls.current.set(`${tool.at}:${tool.name}`, {
        role,
        kind: tool.subject,
        at: Date.parse(tool.at),
      });
  }
  const handoffKind = (run: InFlightRun): string | undefined => {
    const known = runKinds.current.get(run.runId);
    if (known !== undefined) return known;
    const started = Date.parse(run.startedAt);
    const call = [...handoffCalls.current]
      .filter(
        ([key, item]) =>
          item.role === run.role &&
          item.at <= started &&
          !usedCalls.current.has(key),
      )
      .sort(([, left], [, right]) => right.at - left.at)[0];
    if (call === undefined) return undefined;
    usedCalls.current.add(call[0]);
    runKinds.current.set(run.runId, call[1].kind);
    return call[1].kind;
  };
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
      dispatch: runDispatch(run, handoffKind(run)),
    }));
  const design = artifacts.find((item) => item.kind === "design");
  // Concepts stay to compare until the chosen one is filed as the design, or a new round starts.
  const concepts =
    design !== undefined && !inFlight.some((run) => run.concept !== undefined)
      ? []
      : designConcepts(
          options,
          inFlight,
          [...settledApprovals, ...pendingApprovals].flatMap(
            (approval) => approval.concepts ?? [],
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
  // Filed concepts wait on the person's choice, asked last in the conversation; a choice made here
  // keeps its outcome where it was made.
  const choosable = concepts.some((concept) => concept.chosen)
    ? []
    : concepts.filter((concept) => concept.option !== undefined);
  const shownChoice =
    designChoice !== null
      ? {
          at: designChoice.at,
          card: <DesignChosen concept={designChoice.concept} />,
        }
      : choosable.length > 0
        ? {
            card: (
              <DesignChoice
                projectId={projectId}
                concepts={choosable}
                onShowConcept={openDocument}
                onChosen={(concept) => {
                  setDesignChoice({ concept, at: Date.now() });
                  onChanged();
                }}
              />
            ),
          }
        : undefined;
  // The themes join the pane at the point the coordinator may start the design.
  const designReached =
    DESIGN_INPUTS.every((kind) =>
      artifacts.some((item) => item.kind === kind),
    ) ||
    options.length > 0 ||
    inFlight.some((run) => run.concept !== undefined);
  useLiveAppPresence(projectId);
  const appFiled = (snapshot?.artifacts ?? []).some(
    (item) => item.kind === "app",
  );
  const firstBuilder = appFiled
    ? undefined
    : inFlight.find((run) => run.role === "coder");
  const liveApp = paneDeliverables.some((item) => item.kind === "build_plan")
    ? { projectId, builder: firstBuilder }
    : null;
  // While an approval is open the pane follows the document it approves.
  const approvalDeliverableId =
    pendingApprovals.find((approval) => approval.document !== undefined)
      ?.document?.kind ?? null;
  const filed = useFiledVersions({
    projectId,
    ready: roomSnapshotReady(projectId, snapshot),
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
      approvalDeliverableId,
      filedDeliverableId: filed.at(-1)?.kind ?? null,
      working: streaming || thinking,
      liveText: `${liveText}\n${latestAssistant}`,
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

  if (lifecycle.isError && status === undefined)
    return <RoomFault onRetry={() => void lifecycle.refetch()} />;
  if (!roomSnapshotReady(projectId, snapshot)) {
    if (room.isError) return <RoomFault onRetry={() => void room.refetch()} />;
    return <RoomSkeleton />;
  }

  // Until the first document is filed there is nothing to read beside the conversation, so it
  // takes the whole width; the document pane arrives with that document.
  const chatFirst =
    paneDeliverables.length === 0 &&
    designDraft === null &&
    concepts.length === 0;

  return (
    <div className="stage-view" aria-label={`Conversation for ${projectTitle}`}>
      <div
        className="room workspace-room"
        data-mobile-pane={chatFirst ? "conversation" : mobilePane}
      >
        {chatFirst ? null : (
          <nav className="workspace-mobile-switch" aria-label="Workspace panes">
            <button
              type="button"
              aria-pressed={mobilePane === "conversation"}
              onClick={() => setMobilePane("conversation")}
            >
              Conversation
            </button>
            <button
              type="button"
              aria-pressed={mobilePane === "artifacts"}
              onClick={() => setMobilePane("artifacts")}
            >
              Artifacts ({paneDeliverables.length + concepts.length})
            </button>
          </nav>
        )}
        <div
          className={`${PANES_CLASS} workspace-split${chatFirst ? " chat-first" : ""}`}
        >
          <section className={CONV_CLASS} aria-label="Project conversation">
            <div className="stage-conversation">
              {archived ? null : (
                <NextStepLine
                  projectId={projectId}
                  actions={{
                    reply: requestChanges,
                    resume_coordinator: () => void startCoordinator(),
                    ...(liveApp === null
                      ? {}
                      : {
                          open_app: () => {
                            setPaneTab({ value: LIVE_TAB });
                            setMobilePane("artifacts");
                          },
                        }),
                  }}
                />
              )}
              <DispatchRoomContext.Provider value={dispatchRoom}>
                <RoomThread
                  turns={shownTurns}
                  updates={specialistUpdates}
                  thinking={thinking}
                  documents={paneDeliverables.map((item) => ({
                    id: item.kind,
                    title: item.title,
                  }))}
                  onOpenDocument={openDocument}
                  shownDocument={chatFirst ? null : (selected?.kind ?? null)}
                  approvals={[...settledApprovals, ...pendingApprovals]}
                  results={liveRun.results}
                  runs={unseenRuns}
                  {...(shownChoice === undefined || archived
                    ? {}
                    : { designChoice: shownChoice })}
                  live={(dispatch) => dispatchLive(dispatch, dispatchRoom)}
                  onDecide={onDecideApproval}
                  onRequestChanges={requestChanges}
                  approvalDisabled={approvalBusy || archived}
                  {...(approvalError === null ? {} : { approvalError })}
                  {...(typedYes.held === null
                    ? {}
                    : {
                        typedYes: {
                          held: typedYes.held,
                          onUndo: typedYes.undo,
                        },
                      })}
                  {...(sentId === undefined ? {} : { sentId })}
                  onAnswerQuestions={(reply) => deliver(reply)}
                  questionsDisabled={sending || archived}
                >
                  {archived ? (
                    <ConversationEmptyState
                      title={wording.archivedProject.conversationTitle}
                      description={wording.archivedProject.conversationLead}
                    />
                  ) : shownTurns.length === 0 && !thinking ? (
                    <ConversationEmptyState
                      title={wording.conversation.empty}
                      description={wording.conversation.emptyLead}
                    />
                  ) : null}
                </RoomThread>
              </DispatchRoomContext.Provider>
              {archived ? (
                <div className="banner" role="status">
                  <p className="banner-title">
                    {wording.archivedProject.title}
                  </p>
                  <p>{wording.archivedProject.lead}</p>
                  {restoreFault === null ? null : (
                    <p className="workspace-fault" role="alert">
                      {restoreFault}
                    </p>
                  )}
                  <div className="banner-action">
                    <UiButton
                      type="button"
                      size="sm"
                      disabled={restoring}
                      onClick={() => void restore()}
                    >
                      {restoring
                        ? wording.archivedProject.restoring
                        : wording.archivedProject.restore}
                    </UiButton>
                  </div>
                </div>
              ) : modelNeeded !== null ? (
                // A coordinator with no model to run on cannot answer, even one still bound from before.
                <div className="banner" role="alert">
                  <p className="banner-title">{modelNeeded}</p>
                  <div className="banner-action">
                    <UiButton type="button" size="sm" onClick={onOpenSettings}>
                      {wording.action.openSettings}
                    </UiButton>
                    <UiButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void startCoordinator()}
                    >
                      {wording.action.retry}
                    </UiButton>
                  </div>
                </div>
              ) : unbound ? (
                // The person does not start the coordinator by typing: an unbound room waits for the
                // start that opening it asked for, and a refused start says why and offers it again.
                startFault === null ? (
                  <div className="banner" role="status">
                    <p className="banner-title">
                      {wording.conversation.startingCoordinator}
                    </p>
                  </div>
                ) : (
                  <div className="banner" role="alert">
                    <p className="banner-title">{startFault}</p>
                    <div className="banner-action">
                      <UiButton
                        type="button"
                        size="sm"
                        onClick={() => void startCoordinator()}
                      >
                        {wording.action.retry}
                      </UiButton>
                    </div>
                  </div>
                )
              ) : (
                <div
                  className="composer"
                  data-working={working || sending ? "" : undefined}
                >
                  {attachFault === null ? null : (
                    <p className="workspace-fault" role="alert">
                      {attachFault}
                    </p>
                  )}
                  {sendFailed && sendFault ? (
                    <p className="workspace-fault" role="alert">
                      {sendFault}
                    </p>
                  ) : null}
                  {caution === null ? null : (
                    <div className="workspace-caution" role="alert">
                      <p>
                        {wording.earlierDocument.warning(
                          participantLabel(caution),
                        )}
                      </p>
                      <div className="workspace-caution-actions">
                        <UiButton type="button" size="sm" onClick={sendNow}>
                          {wording.earlierDocument.sendAnyway}
                        </UiButton>
                        <UiButton
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCaution(null);
                            composerRef.current?.focus();
                          }}
                        >
                          {wording.action.cancel}
                        </UiButton>
                      </div>
                    </div>
                  )}
                  {replies.length > 0 ? (
                    <div
                      className="workspace-replies"
                      role="group"
                      aria-label="Suggested replies"
                    >
                      {replies.map((reply) => (
                        <UiButton
                          key={reply}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void deliver(reply)}
                        >
                          {reply}
                        </UiButton>
                      ))}
                    </div>
                  ) : null}
                  <AttachmentDropZone
                    onFiles={addFiles}
                    disabled={
                      limits === undefined ||
                      limits.mimeTypes.length === 0 ||
                      sending ||
                      approvalBusy
                    }
                    label={wording.conversation.dropFiles}
                  >
                    <Dictated
                      value={value}
                      onValueChange={setValue}
                      disabled={sending || approvalBusy}
                    >
                      {(mic) => (
                        <PromptInput
                          className={COMPOSER_BOX_CLASS}
                          value={value}
                          onValueChange={setValue}
                          onSubmit={send}
                          canSubmit={value.trim() !== "" || files.length > 0}
                          status={
                            sending || approvalBusy ? "submitted" : "ready"
                          }
                          disabled={sending || approvalBusy}
                        >
                          {files.length === 0 ? null : (
                            <PromptInputFloat>
                              <Attachments
                                variant="stack"
                                total={files.length}
                                returnFocusTo={composerRef}
                              >
                                {files.map((item) => (
                                  <Attachment key={item.id} data={item}>
                                    <AttachmentPreview />
                                    <AttachmentInfo />
                                    <AttachmentRemove
                                      onClick={() =>
                                        setFiles((current) =>
                                          current.filter(
                                            (held) => held.id !== item.id,
                                          ),
                                        )
                                      }
                                    />
                                  </Attachment>
                                ))}
                              </Attachments>
                            </PromptInputFloat>
                          )}
                          <PromptInputTextarea
                            ref={composerRef}
                            placeholder={
                              openApproval === undefined
                                ? "Say what you need…"
                                : wording.approval.composerPlaceholder
                            }
                          />
                          <PromptInputToolbar>
                            {mic}
                            {limits === undefined ||
                            limits.mimeTypes.length === 0 ? null : (
                              <>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  multiple
                                  hidden
                                  accept={limits.mimeTypes.join(",")}
                                  onChange={(event) => {
                                    if (event.target.files !== null)
                                      addFiles(event.target.files);
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
                            <PromptInputSubmit className="ms-auto" />
                          </PromptInputToolbar>
                        </PromptInput>
                      )}
                    </Dictated>
                  </AttachmentDropZone>
                </div>
              )}
            </div>
          </section>
          {chatFirst ? null : (
            <DesignTarget.Provider value={{ projectId }}>
              <ArtifactPane
                projectTitle={projectTitle}
                draft={designDraft}
                concepts={{ projectId, views: concepts }}
                openTab={paneTab}
                liveApp={liveApp}
                themes={
                  designReached && design === undefined && !archived
                    ? { projectId, onUse: addToComposer }
                    : null
                }
                deliverables={paneDeliverables}
                selected={selected}
                paneRef={documentPaneRef}
                state={
                  selected
                    ? (selectedState ?? { status: "loading" })
                    : undefined
                }
                {...(selectedState?.status === "error" &&
                selectedState.retryable
                  ? {
                      onRetry: () => {
                        if (selected) retryDocument(selected);
                      },
                    }
                  : {})}
                onSelect={chooseDocument}
                changesOpen={selected !== null && changesFor === selected.kind}
                onToggleChanges={() =>
                  setChangesFor((current) =>
                    current === selected?.kind
                      ? null
                      : (selected?.kind ?? null),
                  )
                }
                onReadVersion={async (version) => {
                  if (selected === null)
                    throw new Error("No artifact is selected.");
                  const { content, filedAt, approaches } = await readArtifact(
                    projectId,
                    selected.artifactId,
                    version,
                  );
                  return approaches === undefined
                    ? { content, filedAt }
                    : { content, filedAt, approaches };
                }}
                approachChoice={{
                  chosen: (meta, filedAt) =>
                    chosenApproach(meta, turns, Date.parse(filedAt)),
                  ...(archived ? {} : { choose: chooseApproach }),
                }}
                {...(archived ? {} : { onAddToPrompt: addToPrompt })}
              />
            </DesignTarget.Provider>
          )}
        </div>
      </div>
      {shell.reply}
    </div>
  );
}
