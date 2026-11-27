/**
 * The specialist runs the conversation hands off to, each as a card. A card keeps its result after
 * its run ends, a run with no hand-off in view still gets one, and every card with a run streams
 * its steps from the moment the call that started it returns. A run stopped here reads as stopped
 * before it has wound down.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { InFlightRun } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { stopRun } from "../../api/activity.ts";
import type { Wait } from "../../api/types.ts";
import { humanFault } from "../../human-fault.ts";
import { keys } from "../../queries/keys.ts";
import { conceptTab } from "./design-concept.ts";
import {
  askedOf,
  endedRuns,
  filedDispatches,
  noteDispatches,
  partsDispatches,
  unseenRuns as unseenRunsOf,
  type DispatchRoom,
  type Sighting,
} from "./dispatch.ts";
import type { CallResult } from "./live-run.ts";
import type { RoomSnapshot } from "./load-room.ts";
import { useRunStreams } from "./run-preview.ts";
import type { ShownDocument } from "./screen-question.tsx";
import { useSessionMemory, withEntries } from "./session-memory.ts";
import { LIVE_TAB } from "./tab-follow.ts";
import type { TranscriptTurn } from "./visible-chat.ts";

const NO_RUNS: ReadonlyMap<string, InFlightRun> = new Map();
const NO_SIGHTINGS: ReadonlyMap<string, Sighting> = new Map();

export function useRunCards({
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
}: {
  projectId: string;
  runTenantId: string | undefined;
  snapshot: RoomSnapshot;
  /** The conversation as shown, whose replies' calls hand work off. */
  shownTurns: readonly TranscriptTurn[];
  /** What each of the coordinator's calls returned. */
  coordinatorResults: ReadonlyMap<string, CallResult>;
  /** The filed documents, whose summaries a card shows as its result. */
  shownDocuments: readonly ShownDocument[];
  /** The open decisions; undefined until read. */
  waits: readonly Wait[] | undefined;
  reload: () => void;
  openProject: (tab: string) => void;
  openDocument: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const inFlight = snapshot.inFlight;
  // The runs the person stopped here, which read as stopped before they have wound down.
  const [stoppedHere, setStoppedHere] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const dispatches = shownTurns.flatMap((turn) =>
    turn.role === "assistant" && turn.parts !== undefined
      ? partsDispatches(turn.parts, coordinatorResults)
      : [],
  );
  // Every specialist run this session saw, so its card keeps its result after the run ends. A run
  // with no hand-off in this session's view, such as after a reload, still gets its card.
  const runCards = useSessionMemory(NO_RUNS, (known) =>
    withEntries(
      known,
      inFlight.map((run) => [run.runId, run] as const),
      () => true,
    ),
  );
  const unseenRuns = unseenRunsOf(runCards.values(), dispatches);
  const allDispatches = [
    ...dispatches,
    ...unseenRuns.map(({ dispatch }) => dispatch),
  ];
  // When this session first saw each hand-off, so the document it files reads as its result.
  const dispatchSeen = useSessionMemory(NO_SIGHTINGS, (known) =>
    noteDispatches(known, snapshot.artifacts, allDispatches),
  );
  // Every card with a run streams its steps and what it is producing from the moment the call that
  // started it returns, rather than once the room's next read lists it at work, and a step it takes
  // reads the room again so its state moves with it.
  const {
    previews,
    steps: runSteps,
    results: runResults,
    ended: runsEnded,
  } = useRunStreams(
    runTenantId,
    allDispatches.flatMap((dispatch) =>
      dispatch.runId === undefined ? [] : [dispatch.runId],
    ),
    new Set(
      inFlight.flatMap((run) =>
        run.state === "waiting" && run.since !== undefined ? [run.runId] : [],
      ),
    ),
    reload,
  );
  // A run no longer at work has saved how it ended, which the last read of its record predates.
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
    seen: dispatchSeen,
    summaries: new Map(
      shownDocuments.flatMap(({ kind, summary }): [string, string][] =>
        summary === undefined ? [] : [[kind, summary]],
      ),
    ),
    previews,
    steps: runSteps,
    asked: askedOf(waits),
    ended: endedRuns(runsEnded, stoppedHere),
    onOpenDocument: (kind) => {
      // The app's source is read as the running app.
      if (kind === "app") return openProject(LIVE_TAB);
      openDocument(
        kind.startsWith("concept:") ? conceptTab(kind.slice(8)) : kind,
      );
    },
    onStop: async (stopped) => {
      try {
        await stopRun(projectId, stopped);
        setStoppedHere((before) => new Set(before).add(stopped));
        reload();
      } catch (cause) {
        toast.error(humanFault(cause, wording.dispatch.notStopped));
      }
    },
  };
  const cards = filedDispatches(dispatchRoom, dispatches, unseenRuns);

  return {
    /** The hand-offs in the conversation. */
    dispatches,
    /** Those and the runs at work with no hand-off in view. */
    allDispatches,
    dispatchRoom,
    /** Each card, placed where it shows. */
    cards,
    /** What each specialist run's calls returned. */
    runResults,
  };
}
