/**
 * The coordinator's hand-offs: who each started, on what, the instruction it
 * actually gave, and that run's state as native records report it. The call
 * and its result come from the run stream's own tool frames; the run's state
 * comes from the project's run list (at work, parked, failed) and its filed
 * documents.
 */
import type { ConversationPart, PartTool } from "@corbits/react-ui";
import type { AgentActivity, ProjectArtifact } from "@corbits-builder/client";
import {
  isDocumentKind,
  type FailedRun,
  type InFlightRun,
} from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import type { CallResult } from "./live-run.ts";
import type { PlacedDispatch } from "./transcript.tsx";

const text = wording.dispatch;

type Role = InFlightRun["role"];

const EXECUTE = "execute";

// The specialist actions an execute call starts, by plugin and action, with the document a writer
// action always writes.
const ACTION_ROLE: Record<
  string,
  { readonly role: Role; readonly kind?: string }
> = {
  "coder build": { role: "coder" },
  "coder change": { role: "coder" },
  "writer write-requirements": {
    role: "writer",
    kind: "product_requirements",
  },
  "writer write-build-plan": { role: "writer", kind: "build_plan" },
  "writer write": { role: "writer" },
  "writer review": { role: "reviewer" },
  "designer mockup": { role: "designer" },
};

/** One run a hand-off started or instructed. A design call with concepts is one per concept. */
export type Dispatch = {
  readonly key: string;
  /** The tool call that made it. */
  readonly call: string;
  readonly tool: string;
  /** The plugin action an execute call started, such as "coder change". */
  readonly action?: string;
  readonly role: Role;
  /** The document kind a writer or reviewer works on. */
  readonly kind?: string;
  readonly concept?: string;
  /** The concept's art direction, as the call gave it. */
  readonly direction?: string;
  readonly instruction?: string;
  /** The run the hub reported starting, from the call's result. */
  readonly runId?: string;
  /** The hub refused the call; its own reason. */
  readonly refused?: string;
  /** The call is still being made. */
  readonly pending: boolean;
  /** Stands for a filed thing whose hand-off is not in view, such as one from an earlier session. */
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

/**
 * Who an execute call starts and the input the specialist gets. A call still streaming its
 * arguments names no action yet.
 */
function handoffOf(part: PartTool) {
  if (part.name !== EXECUTE) return undefined;
  const args = record(part.input);
  const action = `${str(args?.["plugin"])} ${str(args?.["action"])}`;
  const started = ACTION_ROLE[action];
  if (started === undefined) return undefined;
  const input = record(args?.["input"]);
  return {
    role: started.role,
    action,
    args: input,
    kind: str(input?.["kind"]) ?? started.kind ?? str(input?.["title"]),
  };
}

/**
 * Whether a coordinator tool call is a hand-off card. A call whose result is an error started
 * nothing, so it is no card: it stays a step of the coordinator's own work.
 */
export const isHandoff = (part: PartTool, result: CallResult | undefined) =>
  handoffOf(part) !== undefined && result?.isError !== true;

/** The quiet line for an execute call the hub refused, naming whom it tried to start and the refusal's first sentence. */
export function refusalLine(
  part: PartTool,
  result: CallResult | undefined,
): string | undefined {
  const handoff = handoffOf(part);
  if (handoff === undefined || result?.isError !== true) return undefined;
  const reason = str(result.content)?.split(/(?<=\.)\s/, 1)[0];
  return wording.activity.handoffCorrected(
    wording.activity.handoffWho[handoff.action] ?? handoff.action,
    reason ?? text.refusedUnknown,
  );
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
  if (concepts.length === 0) {
    const runId = str(record(output)?.["runId"]);
    return [
      {
        ...base,
        key: part.toolCallId,
        ...(runId === undefined ? {} : { runId }),
      },
    ];
  }
  const outcomes = Array.isArray(output) ? output.map(record) : [];
  return concepts.map(({ label: concept, direction }) => {
    const outcome = outcomes.find((item) => item?.["concept"] === concept);
    const runId = str(outcome?.["runId"]);
    const refused = str(outcome?.["error"]);
    return {
      ...base,
      key: `${part.toolCallId}:${concept}`,
      concept,
      ...(direction === undefined ? {} : { direction }),
      ...(runId === undefined ? {} : { runId }),
      ...(refused === undefined ? {} : { refused }),
    };
  });
}

/** Every hand-off in one turn's parts, in call order. */
export function partsDispatches(
  parts: readonly ConversationPart[],
  results: ReadonlyMap<string, CallResult>,
): Dispatch[] {
  return parts.flatMap((part) => {
    const tools =
      part.kind === "tool-trace"
        ? [part]
        : part.kind === "tool-batch"
          ? part.tools
          : [];
    return tools.flatMap((tool) =>
      dispatchesOf(tool, results.get(tool.toolCallId)),
    );
  });
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
  /** The runs mid-turn, with the tool calls and words their own inference events carried; undefined until read. */
  readonly activity: readonly AgentActivity[] | undefined;
  readonly onOpenDocument?: (kind: string) => void;
  /** Opens the project view on what a working designer or coder is making. */
  readonly onWatch?: (dispatch: Dispatch) => void;
};

/** The artifact a hand-off files, by kind. */
export function targetKind(dispatch: Dispatch): string | undefined {
  if (dispatch.role === "writer") return dispatch.kind;
  if (dispatch.role === "designer")
    return dispatch.concept === undefined ? "design" : undefined;
  if (dispatch.role === "coder") return "app";
  if (dispatch.role === "presenter") return "approval_package";
  return undefined;
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
  | { readonly state: "failed"; readonly reason: string };

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

const readyOf = (filed: ProjectArtifact): DispatchStatus => ({
  state: "ready",
  kind: filed.kind === "design_option" ? `concept:${filed.title}` : filed.kind,
  title: filed.title,
  version: filed.version,
});

/** Where a hand-off stands, from native run records and the filed documents. */
export function dispatchStatus(
  dispatch: Dispatch,
  room: DispatchRoom,
): DispatchStatus {
  if (dispatch.refused !== undefined)
    return { state: "failed", reason: dispatch.refused };
  if (dispatch.filed === true) {
    const filed = target(dispatch, room.artifacts);
    if (filed !== undefined) return readyOf(filed);
  }
  if (dispatch.pending) return { state: "starting" };
  const seen = room.seen.get(dispatch.key);
  const moved = room.artifacts.filter(
    (item) => item.version > (seen?.versions.get(identity(item)) ?? 0),
  );
  // A writer named by no call is known by the one document that moved since it was seen.
  const writes =
    dispatch.role === "writer" && dispatch.kind === undefined
      ? moved.filter((item) => WRITTEN.has(item.kind))
      : [];
  const filed =
    target(dispatch, room.artifacts) ??
    (writes.length === 1 ? writes[0] : undefined);
  if (filed !== undefined && moved.includes(filed)) return readyOf(filed);
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
  const run = room.inFlight.find((item) =>
    dispatch.runId === undefined
      ? item.role === dispatch.role &&
        (dispatch.concept ?? null) === (item.concept ?? null)
      : item.runId === dispatch.runId,
  );
  // A run started before this session saw it and now ended is done; nothing else says more.
  if (run === undefined)
    return dispatch.runId === undefined
      ? { state: "starting" }
      : { state: "finished" };
  if (run.state === "approval") return { state: "approval" };
  if (run.state === "working")
    return { state: "working", since: run.since ?? run.startedAt };
  // A parked run that filed its document is done with it, whenever this session first saw it.
  if (filed !== undefined) return readyOf(filed);
  return run.since === undefined
    ? { state: "starting" }
    : { state: "finished" };
}

/** The hand-off's run is still starting, at work or held on an approval, so its work is current. */
export function dispatchLive(dispatch: Dispatch, room: DispatchRoom): boolean {
  noteDispatch(room, dispatch);
  const { state } = dispatchStatus(dispatch, room);
  return state === "starting" || state === "working" || state === "approval";
}

/** What a hand-off works on: "Constraints", "Quiet concept", "the app". */
export function subjectOf(dispatch: Dispatch): string | undefined {
  if (dispatch.concept !== undefined)
    return wording.design.conceptTitle(dispatch.concept);
  if (dispatch.kind !== undefined)
    return (
      wording.documentTab[dispatch.kind] ?? dispatch.kind.replaceAll("_", " ")
    );
  return text.subject[dispatch.role];
}

// Who files each thing that is not a document; the coordinator files the brief, so it has no card.
const FILED_BY: Record<string, Role> = {
  design: "designer",
  design_option: "designer",
  app: "coder",
  approval_package: "presenter",
};

/**
 * Each filed thing no hand-off or run card in view made, such as one filed in an earlier session,
 * as a finished hand-off placed when its current version was filed.
 */
export function filedDispatches(
  artifacts: readonly ProjectArtifact[],
  carded: readonly Dispatch[],
): PlacedDispatch[] {
  const made = new Set(carded.map((dispatch) => target(dispatch, artifacts)));
  return artifacts.flatMap((item) => {
    const writes = isDocumentKind(item.kind) && item.kind !== "problem_brief";
    const role = writes ? "writer" : FILED_BY[item.kind];
    if (role === undefined || made.has(item)) return [];
    const key = `filed:${item.artifactId}`;
    return [
      {
        at: Date.parse(item.filedAt),
        dispatch: {
          key,
          call: key,
          tool: "write_artifact",
          role,
          pending: false,
          filed: true,
          ...(writes ? { kind: item.kind } : {}),
          ...(item.kind === "design_option" ? { concept: item.title } : {}),
        },
      },
    ];
  });
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
