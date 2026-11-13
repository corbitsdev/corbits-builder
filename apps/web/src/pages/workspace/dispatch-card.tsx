/**
 * The coordinator's hand-offs: who each started, on what, the instruction it
 * actually gave, and that run's state as native records report it. The call
 * and its result come from the run stream's own tool frames; the run's state
 * comes from the project's run list (at work, parked, failed) and its filed
 * documents.
 */
import type { ConversationPart, PartTool } from "@corbits/react-ui";
import type { ProjectArtifact } from "@corbits-builder/client";
import {
  isDocumentKind,
  type FailedRun,
  type InFlightRun,
} from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import type { CallResult } from "./live-run.ts";
import type { RunPreview } from "./run-preview.ts";
import { actionRole, roleOf, startingActions } from "./roles.ts";
import type { PlacedDispatch } from "./transcript.tsx";

const text = wording.dispatch;

// Whether a role files a document of whatever kind its task names.
const writesDocuments = (role: string) => roleOf(role)?.filesDocuments === true;

const EXECUTE = "execute";

/** One run a hand-off started or instructed. A design call with concepts is one per concept. */
export type Dispatch = {
  readonly key: string;
  /** The tool call that made it. */
  readonly call: string;
  readonly tool: string;
  /** The plugin action an execute call started, such as "coder change". */
  readonly action?: string;
  readonly role: string;
  /** The document kind a writer or reviewer works on. */
  readonly kind?: string;
  readonly concept?: string;
  /** The concept's art direction, as the call gave it. */
  readonly direction?: string;
  readonly instruction?: string;
  /** The run the hub reported starting, from the call's result. */
  readonly runId?: string;
  /** The call is still being made. */
  readonly pending: boolean;
  /** A run with no hand-off in view, named by the document it filed. */
  readonly filed?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parsed(content: unknown): unknown {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content) as unknown;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    return content;
  }
}

// The hub starts an action named without its plugin when only one plugin has it, so the call is
// read the same way.
function actionOf(plugin: string | undefined, action: string | undefined) {
  if (action === undefined) return undefined;
  if (plugin !== undefined) return `${plugin} ${action}`;
  const [only, ...others] = startingActions().filter((key) =>
    key.endsWith(` ${action}`),
  );
  return others.length === 0 ? only : undefined;
}

/**
 * Who an execute call starts and the input the specialist gets. A call still streaming its
 * arguments names no action yet.
 */
function handoffOf(part: PartTool) {
  if (part.name !== EXECUTE) return undefined;
  const args = record(part.input);
  const action = actionOf(str(args?.["plugin"]), str(args?.["action"]));
  const started = action === undefined ? undefined : actionRole(action);
  if (action === undefined || started === undefined) return undefined;
  const input = record(args?.["input"]);
  return {
    role: started.role,
    action,
    args: input,
    kind: str(input?.["kind"]) ?? started.kind ?? str(input?.["title"]),
  };
}

/** The hand-offs one coordinator tool call made, or none when it is not a hand-off. */
export function dispatchesOf(
  part: PartTool,
  result: CallResult | undefined,
): Dispatch[] {
  const handoff = handoffOf(part);
  if (handoff === undefined) return [];
  const { role, action, args, kind } = handoff;
  const pending = part.status !== "output-available";
  const instruction = str(args?.["instruction"]);
  const base = {
    call: part.toolCallId,
    tool: part.name,
    role,
    pending,
    ...(action === undefined ? {} : { action }),
    ...(instruction === undefined ? {} : { instruction }),
    ...(kind === undefined ? {} : { kind }),
  };
  const output = result === undefined ? undefined : parsed(result.content);
  // An error result started nothing: the coordinator's own call was corrected, so it is no card.
  if (result?.isError === true) return [];
  const named = args?.["concepts"];
  const concepts = Array.isArray(named)
    ? named.flatMap((item) => {
        const label = str(record(item)?.["label"]);
        const direction = str(record(item)?.["direction"]);
        return label === undefined ? [] : [{ label, direction }];
      })
    : [];
  // The hub answers a start with each run it started and each concept it did not, with why. A
  // concept it did not start goes back to the coordinator in that answer, so it is no card.
  const started = record(output);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map(record) : [];
  const runs = list(started?.["runs"]);
  const notStarted = new Set(
    list(started?.["notStarted"]).map((item) => item?.["concept"]),
  );
  if (concepts.length === 0) {
    const runId = str(runs[0]?.["runId"]);
    return [
      {
        ...base,
        key: part.toolCallId,
        ...(runId === undefined ? {} : { runId }),
      },
    ];
  }
  return concepts.flatMap(({ label: concept, direction }) => {
    if (notStarted.has(concept)) return [];
    const runId = str(
      runs.find((item) => item?.["concept"] === concept)?.["runId"],
    );
    return [
      {
        ...base,
        key: `${part.toolCallId}:${concept}`,
        concept,
        ...(direction === undefined ? {} : { direction }),
        ...(runId === undefined ? {} : { runId }),
      },
    ];
  });
}

/** Every hand-off in one turn's parts, in call order. */
export function partsDispatches(
  parts: readonly ConversationPart[],
  results: ReadonlyMap<string, CallResult>,
): Dispatch[] {
  return parts.flatMap((part) =>
    part.kind === "tool-trace"
      ? dispatchesOf(part, results.get(part.toolCallId))
      : [],
  );
}

export type DispatchRoom = {
  readonly artifacts: readonly ProjectArtifact[];
  readonly inFlight: readonly InFlightRun[];
  readonly failed: readonly FailedRun[];
  /** What this session saw when each hand-off first appeared, by its key. */
  readonly seen: Map<
    string,
    {
      readonly at: number;
      readonly versions: ReadonlyMap<string, number>;
    }
  >;
  /** What each streamed run is producing right now, by run id. */
  readonly previews?: ReadonlyMap<string, RunPreview>;
  /** Each call a streamed run made while the room watched it, in order, by run id. */
  readonly steps?: ReadonlyMap<string, readonly PartTool[]>;
  /** How each shown run ended, as its saved record or a stop made here says, by run id. */
  readonly ended?: ReadonlyMap<string, RunEnd>;
  /** Each filed document's own `## In short` section, by kind, once its body has loaded. */
  readonly summaries?: ReadonlyMap<string, string>;
  readonly onOpenDocument?: (kind: string) => void;
  /** Opens the project view on what a working designer or coder is making. */
  readonly onWatch?: (dispatch: Dispatch) => void;
  /** Stops a working specialist's run as the person. */
  readonly onStop?: (runId: string) => Promise<void>;
};

/** A run's status as Interchange reports it, with why when it failed and what blocked it. */
export type RunEnd = {
  readonly status: string;
  readonly error?: string;
  readonly blocked?: { readonly reason: string };
};

/** The artifact a hand-off files, by kind. */
export function targetKind(dispatch: Dispatch): string | undefined {
  if (writesDocuments(dispatch.role)) return dispatch.kind;
  // A concept's run files an option of the design, found by its title.
  if (dispatch.concept !== undefined) return undefined;
  return roleOf(dispatch.role)?.files;
}

function target(dispatch: Dispatch, artifacts: readonly ProjectArtifact[]) {
  const kind = targetKind(dispatch);
  if (dispatch.concept !== undefined)
    return artifacts.find(
      (item) =>
        item.kind === "design_option" && item.title === dispatch.concept,
    );
  return kind === undefined
    ? undefined
    : artifacts.find((item) => item.kind === kind);
}

export type DispatchStatus =
  | { readonly state: "starting" }
  | { readonly state: "working"; readonly since: string }
  /** Mid-turn but held on an approval only the person can give. */
  | { readonly state: "approval" }
  | {
      readonly state: "ready";
      readonly title: string;
      readonly version: number;
      readonly kind: string;
    }
  | { readonly state: "finished" }
  /** The person or the coordinator stopped it. */
  | { readonly state: "stopped" }
  | { readonly state: "failed"; readonly reason: string }
  /** It reported something it could not get past, in its own words or Builder's. */
  | { readonly state: "blocked"; readonly reason: string };

/** Records the first sighting of a hand-off, so a document filed later reads as its result. */
export function noteDispatch(room: DispatchRoom, dispatch: Dispatch): void {
  if (room.seen.has(dispatch.key)) return;
  room.seen.set(dispatch.key, {
    at: Date.now(),
    versions: new Map(
      room.artifacts.map((item) => [identity(item), item.version]),
    ),
  });
}

const identity = (item: ProjectArtifact) =>
  item.kind === "design_option" ? `${item.kind}:${item.title}` : item.kind;

// The documents a writer files, so a writer run's own document is the one of these that moved.
const WRITTEN = new Set([
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
]);

// The kind a ready card opens: a concept's option opens under its concept.
const openedKind = (filed: ProjectArtifact) =>
  filed.kind === "design_option" ? `concept:${filed.title}` : filed.kind;

const readyOf = (filed: ProjectArtifact): DispatchStatus => ({
  state: "ready",
  kind: openedKind(filed),
  title: filed.title,
  version: filed.version,
});

/** Where a hand-off stands, from native run records and the filed documents. */
export function dispatchStatus(
  dispatch: Dispatch,
  room: DispatchRoom,
): DispatchStatus {
  // A run that filed its work may still be at work on its report, which its row shows once done.
  const atWork = room.inFlight.some(
    (run) => run.runId === dispatch.runId && run.state !== "waiting",
  );
  if (dispatch.filed === true) {
    const filed = target(dispatch, room.artifacts);
    if (filed !== undefined && !atWork) return readyOf(filed);
  }
  if (dispatch.pending) return { state: "starting" };
  const seen = room.seen.get(dispatch.key);
  const moved = room.artifacts.filter(
    (item) => item.version > (seen?.versions.get(identity(item)) ?? 0),
  );
  // A writer named by no call is known by the one document that moved since it was seen.
  const writes =
    writesDocuments(dispatch.role) && dispatch.kind === undefined
      ? moved.filter((item) => WRITTEN.has(item.kind))
      : [];
  const filed =
    target(dispatch, room.artifacts) ??
    (writes.length === 1 ? writes[0] : undefined);
  if (filed !== undefined && moved.includes(filed) && !atWork)
    return readyOf(filed);
  // The run's own record outlasts the room's short lists of failed runs, and a stop made here
  // shows before the run has wound down. A blocked run ended on its block however Interchange
  // settled it.
  const ended =
    dispatch.runId === undefined ? undefined : room.ended?.get(dispatch.runId);
  if (ended?.blocked !== undefined)
    return { state: "blocked", reason: ended.blocked.reason };
  const after = (iso: string) =>
    seen === undefined || Date.parse(iso) >= seen.at - 60_000;
  const failure = room.failed.find((run) =>
    dispatch.runId === undefined
      ? run.role === dispatch.role && after(run.endedAt)
      : run.runId === dispatch.runId,
  );
  if (failure !== undefined)
    return {
      state: "failed",
      reason: failure.error?.message ?? text.failedUnknown,
    };
  if (ended?.status === "cancelled") return { state: "stopped" };
  if (ended?.status === "failed")
    return { state: "failed", reason: ended.error ?? text.failedUnknown };
  const run = room.inFlight.find((item) =>
    dispatch.runId === undefined
      ? item.role === dispatch.role &&
        (dispatch.concept ?? null) === (item.concept ?? null)
      : item.runId === dispatch.runId,
  );
  // Only the run's own record says it ended: the list of runs at work lags a run just started, and
  // the coordinator's call returns as soon as the run is deployed.
  if (run === undefined) {
    if (ended?.status !== "completed") return { state: "starting" };
    return filed === undefined ? { state: "finished" } : readyOf(filed);
  }
  if (run.state === "approval") return { state: "approval" };
  if (run.state === "working")
    return { state: "working", since: run.since ?? run.startedAt };
  // A run that has not begun its first turn has filed nothing, whatever is already filed.
  if (run.since === undefined) return { state: "starting" };
  // A parked run that filed its document is done with it, whenever this session first saw it.
  return filed === undefined ? { state: "finished" } : readyOf(filed);
}

/** The hand-off's run is still starting, at work or held on an approval, so its work is current. */
export function dispatchLive(dispatch: Dispatch, room: DispatchRoom): boolean {
  noteDispatch(room, dispatch);
  const { state } = dispatchStatus(dispatch, room);
  return state === "starting" || state === "working" || state === "approval";
}

/**
 * The runs with no hand-off in view, in the order they started. A writer run named by no call is
 * named by the document it filed after it started, so that document is its result rather than a row
 * of its own. A filed thing with no run in view gets no row: a specialist's row is a run of this
 * conversation, and what the person chose or brought shows on its own card.
 */
export function filedDispatches(
  room: DispatchRoom,
  handoffs: readonly Dispatch[],
  runs: readonly PlacedDispatch[],
): PlacedDispatch[] {
  const started = runs.toSorted((left, right) => left.at - right.at);
  const covered = new Set(
    [...handoffs, ...started.map(({ dispatch }) => dispatch)].flatMap(
      (dispatch) => {
        const status = dispatchStatus(dispatch, room);
        return [
          targetKind(dispatch),
          status.state === "ready" ? status.kind : undefined,
        ];
      },
    ),
  );
  const named = new Map<string, Dispatch>();
  for (const item of room.artifacts) {
    if (
      !isDocumentKind(item.kind) ||
      item.kind === "problem_brief" ||
      covered.has(item.kind)
    )
      continue;
    const writer = started.findLast(
      ({ at, dispatch }) =>
        writesDocuments(dispatch.role) &&
        dispatch.kind === undefined &&
        !named.has(dispatch.key) &&
        at <= Date.parse(item.filedAt),
    );
    if (writer !== undefined)
      named.set(writer.dispatch.key, {
        ...writer.dispatch,
        kind: item.kind,
        filed: true,
      });
  }
  return started.map(({ at, dispatch }) => ({
    at,
    dispatch: named.get(dispatch.key) ?? dispatch,
  }));
}

/** A run at work the conversation has no hand-off for, such as one started before a reload. */
export function runDispatch(run: InFlightRun): Dispatch {
  return {
    key: `run:${run.runId}`,
    call: `run:${run.runId}`,
    tool: EXECUTE,
    role: run.role,
    runId: run.runId,
    pending: false,
    ...(run.concept === undefined ? {} : { concept: run.concept }),
  };
}
