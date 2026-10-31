/**
 * The coordinator's in-progress reply across every model call of a message run.
 *
 * One message run can make several model calls between tool work. Each call
 * folds into its own segment, and the room shows the segments the durable
 * mirror has not committed yet as one live assistant turn. A segment is
 * committed when the mirror holds an assistant turn with its text that is
 * newer than the newest assistant turn the mirror had when the segment began,
 * so a repeated reply is not mistaken for an earlier one.
 */
import type { ConversationTurn } from "../../api/conversation.ts";
import type { Wait } from "../../api/types.ts";
import type { RunStreamEvent } from "../../api/run-stream.ts";
import type { ConversationPart } from "@corbits/react-ui";
import {
  emptyLiveTurn,
  foldLiveTurn,
  type LiveTurnState,
} from "./conversation-parts.ts";

type Segment = LiveTurnState & {
  /** The mirror's newest assistant `at` when this segment began; null until it does. */
  readonly after: number | null;
};

/** A finished tool call's native result, as its `tool.done` frame carried it. */
export type CallResult = {
  readonly isError: boolean;
  readonly content: unknown;
};

export type LiveRun = {
  readonly segments: readonly Segment[];
  readonly current: Segment;
  /** The message run closed; only uncommitted text remains worth showing. */
  readonly ended: boolean;
  /** This stream saw a message run start and not yet end: the coordinator is mid-turn. */
  readonly running: boolean;
  /** When this stream last saw a message run end, in ms. */
  readonly endedAt: number | null;
  readonly results: ReadonlyMap<string, CallResult>;
};

const emptySegment: Segment = { ...emptyLiveTurn, after: null };

export const emptyLiveRun: LiveRun = {
  segments: [],
  current: emptySegment,
  ended: false,
  running: false,
  endedAt: null,
  results: new Map(),
};

function resultOf(
  event: RunStreamEvent,
): (CallResult & { callId: string }) | undefined {
  const result = (event.data as { result?: unknown } | undefined)?.result;
  if (typeof result !== "object" || result === null) return undefined;
  const { callId, content, isError } = result as Record<string, unknown>;
  if (typeof callId !== "string" || callId.length === 0) return undefined;
  return { callId, content, isError: isError === true };
}

// Frames after which the hub's durable room state (mirror, plan, artifacts,
// run events) can have moved.
const reloadAfter = new Set([
  "inference.done",
  "inference.error",
  "tool.done",
  "connector.reply",
  "message.run.ended",
  "reactor.done",
  "reactor.error",
]);

// The mirror caps each turn's text at this length.
const MIRROR_TEXT_LIMIT = 20_000;

function hasContent(segment: LiveTurnState): boolean {
  return segment.text.length > 0 || segment.parts.length > 0;
}

/** The newest committed assistant turn's time, or null when there is none. */
export function latestAssistantAt(
  mirror: readonly ConversationTurn[],
): number | null {
  let latest: number | null = null;
  for (const turn of mirror) {
    if (turn.role === "assistant" && (latest === null || turn.at > latest))
      latest = turn.at;
  }
  return latest;
}

/** Fold one frame. `committedAt` is the mirror's newest assistant time right now. */
export function foldLiveRun(
  run: LiveRun,
  event: RunStreamEvent,
  committedAt: number | null,
): { run: LiveRun; reload: boolean } {
  const reload = reloadAfter.has(event.type);
  if (event.type === "message.run.started") {
    return {
      run: {
        ...run,
        segments: run.segments.filter((item) => item.text.length > 0),
        ended: false,
        running: true,
      },
      reload,
    };
  }
  if (event.type === "message.run.ended" || event.type === "reactor.done") {
    return {
      run: { ...run, ended: true, running: false, endedAt: Date.now() },
      reload,
    };
  }
  if (event.type === "tool.done") {
    const result = resultOf(event);
    if (result === undefined) return { run, reload };
    const results = new Map(run.results);
    results.set(result.callId, {
      isError: result.isError,
      content: result.content,
    });
    return { run: { ...run, results }, reload };
  }
  if (event.type === "inference.start") {
    return {
      run: {
        ...run,
        segments: hasContent(run.current)
          ? [...run.segments, run.current]
          : run.segments,
        current: { ...emptySegment, after: committedAt },
        ended: false,
        running: true,
      },
      reload,
    };
  }
  const folded = foldLiveTurn(run.current, event);
  const current: Segment = {
    ...folded.turn,
    after: run.current.after ?? committedAt,
  };
  if (event.type === "inference.done") {
    return {
      run: {
        ...run,
        segments: hasContent(current)
          ? [...run.segments, current]
          : run.segments,
        current: emptySegment,
      },
      reload,
    };
  }
  return { run: { ...run, current }, reload: reload || folded.refresh };
}

function sameText(committed: string, live: string): boolean {
  const a = committed.trim();
  const b = live.trim();
  return a === b || (a.length >= MIRROR_TEXT_LIMIT && b.startsWith(a));
}

function committedTurn(
  segment: Segment,
  mirror: readonly ConversationTurn[],
): ConversationTurn | undefined {
  if (segment.text.length === 0) return undefined;
  return mirror.find(
    (turn) =>
      turn.role === "assistant" &&
      (segment.after === null || turn.at > segment.after) &&
      sameText(turn.text, segment.text),
  );
}

function isCommitted(
  segment: Segment,
  mirror: readonly ConversationTurn[],
): boolean {
  return committedTurn(segment, mirror) !== undefined;
}

/**
 * The thinking and tool work behind each assistant turn the mirror committed,
 * by the turn's `at`: the work of every segment since the previous commit.
 * The mirror keeps text only, so this is what lets a finished turn keep its steps.
 */
export function committedSteps(
  run: LiveRun,
  mirror: readonly ConversationTurn[],
): ReadonlyMap<number, readonly ConversationPart[]> {
  const steps = new Map<number, readonly ConversationPart[]>();
  let carried: ConversationPart[] = [];
  for (const segment of [...run.segments, run.current]) {
    carried = [
      ...carried,
      ...segment.parts.filter((part) => part.kind !== "text"),
    ];
    const turn = committedTurn(segment, mirror);
    if (turn === undefined) continue;
    if (carried.length > 0) steps.set(turn.at, carried);
    carried = [];
  }
  return steps;
}

/**
 * What still stands in the log: every segment after the last committed one,
 * merged into one turn. Null when nothing does.
 */
export function pendingLiveTurn(
  run: LiveRun,
  mirror: readonly ConversationTurn[],
): LiveTurnState | null {
  const all = [...run.segments, run.current];
  let lastCommitted = -1;
  all.forEach((segment, index) => {
    if (isCommitted(segment, mirror)) lastCommitted = index;
  });
  // A run that ended on tool work alone (parked on a person) keeps that work in
  // view until the next reply replaces it, rather than flashing and vanishing.
  const pending = all.slice(lastCommitted + 1).filter(hasContent);
  if (pending.length === 0) return null;
  return {
    text: pending
      .map((segment) => segment.text)
      .filter((text) => text.length > 0)
      .join("\n\n"),
    parts: pending.flatMap((segment) => segment.parts),
  };
}

/** The run closed with text the mirror has not committed yet. */
export function awaitingCommit(
  run: LiveRun,
  mirror: readonly ConversationTurn[],
): boolean {
  if (!run.ended) return false;
  return (pendingLiveTurn(run, mirror)?.text.length ?? 0) > 0;
}

/**
 * The coordinator is held on the person: an approval its own run raised is still open, or its
 * question stands and no message run has started since. A held tool call keeps the native message
 * run open, so a run in progress alone does not mean it is working.
 */
export function waitingOnPerson(
  waits: readonly Pick<Wait, "runId" | "approvalId" | "park">[],
  openApprovals: ReadonlySet<string>,
  coordinatorRunId: string | null,
  running: boolean,
): boolean {
  return waits.some(
    (wait) =>
      wait.runId === coordinatorRunId &&
      (wait.approvalId === undefined
        ? wait.park !== undefined && !running
        : openApprovals.has(wait.approvalId)),
  );
}
