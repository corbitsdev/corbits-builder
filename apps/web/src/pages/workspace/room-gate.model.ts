/**
 * What the project room does before it is ready. `useRoomGate` reads the project and its room and
 * starts its coordinator, while the room shows its loading or fault state; `useRoom` works on the
 * loaded snapshot it hands over.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefetchQuery, useQueries, useQuery } from "@tanstack/react-query";
import { ProductApiError } from "@corbits-builder/client";
import { wording, type SettingsTab } from "../../config.ts";
import { getProject, startProjectCoordinator } from "../../api/projects.ts";
import { refusalBody } from "../../api/transport.ts";
import { humanFaultWithCode } from "../../human-fault.ts";
import { keys } from "../../queries/keys.ts";
import { useModelCatalog } from "../model-catalog.ts";
import { needsModelSetup } from "../model-setup.model.ts";
import type { MenuProject } from "../project-menu.model.ts";
import { acceptedMaterialsQuery } from "./composer.model.ts";
import { openDecisionsQuery } from "./decisions.model.ts";
import { useLiveAppPresence } from "./live-app.model.ts";
import {
  keptRoom,
  loadProjectRoom,
  roomSnapshotReady,
  type RoomSnapshot,
} from "./load-room.ts";
import {
  projectActivityQuery,
  projectRunStatesQuery,
} from "./project-activity.ts";
import { runStepsQuery, savedRunIds, useSavedRunSteps } from "./run-preview.ts";

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
