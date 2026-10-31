/**
 * The project room's one read.
 *
 * Conversation and documents land in the shared query cache together. A newer
 * read wins. A document that already loaded is not fetched again, and a failed
 * sync returns the snapshot already in the client instead of an empty room.
 */
import { wording } from "../../config.ts";
import type { QueryClient } from "@tanstack/react-query";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { FailedRun, InFlightRun } from "@corbits-builder/schemas/artifact";
import { listProjectArtifacts, readArtifact } from "../../api/artifacts.ts";
import {
  readConversationEvents,
  type ConversationEvent,
  type ConversationThread,
  type ConversationTurn,
} from "../../api/conversation.ts";
import { keys } from "../../queries/keys.ts";
import { documentReadFailure } from "./document-read.ts";
import { DESIGN_MEDIA_TYPE } from "./design-preview.tsx";
import { humanFault } from "./human-fault.ts";
import type {
  DeliverableState,
  LoadedDeliverable,
} from "./deliverable-block.tsx";

export type RoomSnapshot = {
  conversation: {
    events: ConversationEvent[] | null;
    turns: ConversationTurn[];
    threads: ConversationThread[];
    runId: string | null;
  };
  artifacts: ProjectArtifact[];
  /** The specialist runs at work, which name the design concept a designer works on. */
  inFlight: InFlightRun[];
  /** Specialist runs Interchange settled as failed, with the error their terminal event carries. */
  failed: FailedRun[];
  documents: Record<string, DeliverableState>;
};

export function roomDocumentKey(
  projectId: string,
  artifact: ProjectArtifact,
): string {
  return JSON.stringify([
    projectId,
    artifact.kind,
    artifact.artifactId,
    artifact.version,
    artifact.sha256,
  ]);
}

const DESIGN_KINDS = new Set(["design", "design_option"]);
const MATERIAL_KIND = "material";

// A material holds text as itself and any other file as a data: URL.
function materialMediaType(content: string): string {
  return content.startsWith("data:")
    ? content.slice(5, content.indexOf(";"))
    : "text/plain";
}
const settled = new Map<string, DeliverableState>();
const generation = new Map<string, number>();
const refetchKeys = new Set<string>();
const listeners = new Map<
  string,
  Set<{
    resolve: (snapshot: RoomSnapshot) => void;
    reject: (cause: unknown) => void;
  }>
>();

function currentSnapshot(
  client: QueryClient,
  projectId: string,
): RoomSnapshot | undefined {
  return client.getQueryData<RoomSnapshot>(keys.projectRoom.of(projectId));
}

/** True when every filed document has a real body or a real failure. Loading is not loaded. */
export function roomSnapshotReady(
  projectId: string,
  snapshot: RoomSnapshot | undefined,
): snapshot is RoomSnapshot {
  if (snapshot === undefined) return false;
  for (const item of snapshot.artifacts) {
    const state = snapshot.documents[roomDocumentKey(projectId, item)];
    if (state === undefined || state.status === "loading") return false;
  }
  return true;
}

async function loadDeliverable(
  projectId: string,
  source: ProjectArtifact,
): Promise<LoadedDeliverable> {
  const current = await readArtifact(
    projectId,
    source.artifactId,
    source.version,
  );
  let before: LoadedDeliverable["before"] = null;
  let historyError: string | undefined;
  if (source.version > 1) {
    try {
      const previous = await readArtifact(
        projectId,
        source.artifactId,
        source.version - 1,
      );
      before = {
        version: previous.version,
        content: previous.content,
        filedAt: previous.filedAt,
        ...(previous.approaches === undefined
          ? {}
          : { approaches: previous.approaches }),
      };
    } catch (cause) {
      historyError = humanFault(cause, "Earlier versions are not available.");
    }
  }
  const mediaType = DESIGN_KINDS.has(source.kind)
    ? DESIGN_MEDIA_TYPE
    : source.kind === MATERIAL_KIND
      ? materialMediaType(current.content)
      : "text/markdown";
  return {
    title: current.title,
    mediaType,
    content: current.content,
    filedAt: current.filedAt,
    ...(current.approaches === undefined
      ? {}
      : { approaches: current.approaches }),
    version: source.version,
    sha256: source.sha256,
    before,
    versions: Array.from({ length: source.version }, (_, at) => ({
      version: at + 1,
      title: current.title,
      mediaType,
    })),
    ...(historyError === undefined ? {} : { historyError }),
  };
}

function remember(client: QueryClient, projectId: string): void {
  const existing = currentSnapshot(client, projectId);
  if (existing === undefined) return;
  for (const [key, state] of Object.entries(existing.documents)) {
    if (refetchKeys.has(key) || state.status === "loading" || settled.has(key))
      continue;
    settled.set(key, state);
  }
}

function snapshotFrom(fresh: RoomSnapshot, projectId: string): RoomSnapshot {
  const documents: Record<string, DeliverableState> = {};
  for (const item of fresh.artifacts) {
    const key = roomDocumentKey(projectId, item);
    const state = settled.get(key);
    if (state !== undefined && state.status !== "loading")
      documents[key] = state;
  }
  return {
    conversation: fresh.conversation,
    artifacts: fresh.artifacts,
    inFlight: fresh.inFlight,
    failed: fresh.failed,
    documents,
  };
}

function publish(
  client: QueryClient,
  projectId: string,
  snapshot: RoomSnapshot,
): void {
  if (!roomSnapshotReady(projectId, snapshot)) return;
  client.setQueryData(keys.projectRoom.of(projectId), snapshot);
  const waiting = listeners.get(projectId);
  if (waiting === undefined) return;
  listeners.delete(projectId);
  for (const listener of waiting) listener.resolve(snapshot);
}

function failWaiters(projectId: string, cause: unknown): void {
  const waiting = listeners.get(projectId);
  if (waiting === undefined) return;
  listeners.delete(projectId);
  for (const listener of waiting) listener.reject(cause);
}

function whenReady(
  client: QueryClient,
  projectId: string,
): Promise<RoomSnapshot> {
  const ready = currentSnapshot(client, projectId);
  if (roomSnapshotReady(projectId, ready)) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const listener = {
      resolve,
      reject,
    };
    const waiting = listeners.get(projectId) ?? new Set<typeof listener>();
    waiting.add(listener);
    listeners.set(projectId, waiting);
    const raced = currentSnapshot(client, projectId);
    if (roomSnapshotReady(projectId, raced)) {
      waiting.delete(listener);
      resolve(raced);
    }
  });
}

/**
 * Loads the room into the shared client. A newer call supersedes an older one.
 * An archived project has no conversation to read, so `withConversation` is false for it.
 */
export async function loadProjectRoom(
  projectId: string,
  client: QueryClient,
  withConversation: boolean,
): Promise<RoomSnapshot> {
  const ticket = (generation.get(projectId) ?? 0) + 1;
  generation.set(projectId, ticket);
  const stale = () => generation.get(projectId) !== ticket;
  remember(client, projectId);
  let fresh: RoomSnapshot;
  try {
    const [conversation, { artifacts, inFlight, failed }] = await Promise.all([
      withConversation ? readConversationEvents(projectId) : null,
      listProjectArtifacts(projectId),
    ]);
    fresh = {
      conversation: {
        events: conversation?.events ?? null,
        turns: conversation?.turns ?? [],
        threads: conversation?.threads ?? [],
        runId: conversation?.runId ?? null,
      },
      artifacts,
      inFlight,
      failed,
      documents: {},
    };
  } catch (cause) {
    const saved = currentSnapshot(client, projectId);
    if (roomSnapshotReady(projectId, saved)) return saved;
    if (stale()) return whenReady(client, projectId);
    failWaiters(projectId, cause);
    throw cause;
  }
  if (stale()) return whenReady(client, projectId);

  const live = new Set(
    fresh.artifacts.map((item) => roomDocumentKey(projectId, item)),
  );
  for (const key of settled.keys()) {
    if (generation.get(projectId) !== ticket) break;
    try {
      const owner = JSON.parse(key) as unknown;
      if (Array.isArray(owner) && owner[0] === projectId && !live.has(key))
        settled.delete(key);
    } catch {
      // A key this loader did not write. Leave it.
    }
  }

  await Promise.all(
    fresh.artifacts.flatMap((artifact) => {
      const key = roomDocumentKey(projectId, artifact);
      const have = settled.get(key);
      if (have !== undefined && have.status !== "loading") return [];
      return [
        (async () => {
          let state: DeliverableState;
          try {
            state = {
              status: "ready",
              document: await loadDeliverable(projectId, artifact),
            };
          } catch (cause) {
            const failure = documentReadFailure(cause);
            state = {
              status: "error",
              message: failure.message,
              retryable: failure.retryable,
            };
          }
          if (generation.get(projectId) !== ticket) return;
          settled.set(key, state);
        })(),
      ];
    }),
  );

  if (stale()) return whenReady(client, projectId);
  const snapshot = snapshotFrom(fresh, projectId);
  if (!roomSnapshotReady(projectId, snapshot)) {
    if (stale()) return whenReady(client, projectId);
    const cause = new Error(wording.message.projectNotOpened);
    failWaiters(projectId, cause);
    throw cause;
  }
  publish(client, projectId, snapshot);
  return snapshot;
}

/** Reads one document again. The last real record stays until the new read finishes. */
export function reloadProjectDocument(
  projectId: string,
  docKey: string,
  client: QueryClient,
  withConversation: boolean,
): Promise<RoomSnapshot> {
  settled.delete(docKey);
  refetchKeys.add(docKey);
  return loadProjectRoom(projectId, client, withConversation).finally(() => {
    refetchKeys.delete(docKey);
  });
}
