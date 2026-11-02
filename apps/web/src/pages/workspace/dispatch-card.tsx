/**
 * The coordinator's hand-offs: who each started, on what, the instruction it
 * actually gave, and that run's state as native records report it. The call
 * and its result come from the run stream's own tool frames; the run's state
 * comes from the project's run list (at work, parked, failed) and its filed
 * documents.
 */
import { createContext } from "react";
import type { ConversationPart, PartTool } from "@corbits/react-ui";
import type { AgentActivity, ProjectArtifact } from "@corbits-builder/client";
import type { FailedRun, InFlightRun } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import type { CallResult } from "./live-run.ts";
import type { ApprovalOutcome, DocumentApproval } from "./transcript.tsx";

const text = wording.dispatch;

type Role = InFlightRun["role"];

const ROLE_OF: Record<string, Role> = {
  deploy_writer: "writer",
  review_artifact: "reviewer",
  deploy_coder: "coder",
  instruct_coder: "coder",
  design_app: "designer",
  deploy_presenter: "presenter",
};

export const DISPATCH_TOOLS: ReadonlySet<string> = new Set(
  Object.keys(ROLE_OF),
);

/** One run a hand-off started or instructed. A design call with concepts is one per concept. */
export type Dispatch = {
  readonly key: string;
  /** The tool call that made it. */
  readonly call: string;
  readonly tool: string;
  readonly role: Role;
  /** The document kind a writer or reviewer works on. */
  readonly kind?: string;
  readonly concept?: string;
  readonly instruction?: string;
  /** The run the hub reported starting, from the call's result. */
  readonly runId?: string;
  /** The hub refused the call; its own reason. */
  readonly refused?: string;
  /** The call is still being made. */
  readonly pending: boolean;
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
  } catch {
    return content;
  }
}

/** The hand-offs one coordinator tool call made, or none when it is not a hand-off. */
export function dispatchesOf(
  part: PartTool,
  result: CallResult | undefined,
): Dispatch[] {
  const role = ROLE_OF[part.name];
  if (role === undefined) return [];
  const pending = part.status !== "output-available";
  const args = record(part.input) ?? {};
  const instruction = str(args["instruction"]);
  const kind = str(args["kind"]);
  const base = {
    call: part.toolCallId,
    tool: part.name,
    role,
    pending,
    ...(instruction === undefined ? {} : { instruction }),
    ...(kind === undefined ? {} : { kind }),
  };
  const output = result === undefined ? undefined : parsed(result.content);
  if (result?.isError === true)
    return [
      {
        ...base,
        key: part.toolCallId,
        refused: str(result.content) ?? text.refusedUnknown,
      },
    ];
  const concepts = Array.isArray(args["concepts"])
    ? args["concepts"].flatMap((item) => {
        const label = str(record(item)?.["label"]);
        return label === undefined ? [] : [label];
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
  return concepts.map((concept) => {
    const outcome = outcomes.find((item) => item?.["concept"] === concept);
    const runId = str(outcome?.["runId"]);
    const refused = str(outcome?.["error"]);
    return {
      ...base,
      key: `${part.toolCallId}:${concept}`,
      concept,
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
      readonly call: string;
      readonly ask: string;
    }
  >;
  /** The native approvals, pending or as their records settled them. */
  readonly approvals: readonly DocumentApproval[];
  /** The runs mid-turn, with the tool calls and words their own inference events carried. */
  readonly activity: readonly AgentActivity[];
  readonly onOpenDocument?: (kind: string) => void;
};

export const DispatchRoomContext = createContext<DispatchRoom | null>(null);

/** The artifact a hand-off files, by kind. */
export function targetKind(dispatch: Dispatch): string | undefined {
  if (dispatch.tool === "deploy_writer") return dispatch.kind;
  if (dispatch.tool === "design_app")
    return dispatch.concept === undefined ? "design" : undefined;
  if (dispatch.role === "coder") return "app";
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
  | { readonly state: "waiting" }
  | {
      readonly state: "declined";
      readonly status: Exclude<ApprovalOutcome["status"], "approved">;
    }
  | { readonly state: "starting" }
  | { readonly state: "working"; readonly since: string }
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
  const ask = askOf(dispatch.tool, dispatch.instruction);
  const seen = room.seen.get(dispatch.key);
  // A call is first seen while its arguments still stream, so what it asks settles later.
  if (seen !== undefined) {
    if (seen.ask !== ask) room.seen.set(dispatch.key, { ...seen, ask });
    return;
  }
  room.seen.set(dispatch.key, {
    at: Date.now(),
    call: dispatch.call,
    ask,
    versions: new Map(
      room.artifacts.map((item) => [identity(item), item.version]),
    ),
  });
}

const askOf = (tool: string, instruction: string | undefined) =>
  JSON.stringify([tool, instruction ?? null]);

// The run stream carries only live frames, so a call is first seen before its approval is raised.
// The record names the call's tool and arguments, not the call, so each call asking the same thing
// takes the first approval raised after it that an earlier call has not taken.
const RAISED_SLACK_MS = 60_000;

/** The native approval a hand-off's call waited on, when its tool asks for one. */
function approvalOf(
  dispatch: Dispatch,
  room: DispatchRoom,
): DocumentApproval | undefined {
  if (dispatch.runId !== undefined) return undefined;
  const ask = askOf(dispatch.tool, dispatch.instruction);
  const calls = new Map<string, number>();
  for (const seen of room.seen.values())
    if (seen.ask === ask && !calls.has(seen.call))
      calls.set(seen.call, seen.at);
  const asked = room.approvals
    .filter(
      (approval) =>
        approval.at !== undefined &&
        approval.toolName !== undefined &&
        askOf(approval.toolName, str(approval.instruction)) === ask,
    )
    .sort((left, right) => (left.at ?? 0) - (right.at ?? 0));
  const taken = new Set<DocumentApproval>();
  for (const [call, at] of calls) {
    const approval = asked.find(
      (item) => !taken.has(item) && (item.at ?? 0) >= at - RAISED_SLACK_MS,
    );
    if (call === dispatch.call) return approval;
    if (approval !== undefined) taken.add(approval);
  }
  return undefined;
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
  // A declined or lapsed approval answers the call in the run's own history, never as a result frame.
  const approval = approvalOf(dispatch, room);
  if (approval !== undefined && approval.outcome === undefined)
    return { state: "waiting" };
  if (approval?.outcome !== undefined && approval.outcome.status !== "approved")
    return { state: "declined", status: approval.outcome.status };
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
  if (run.state === "working")
    return { state: "working", since: run.since ?? run.startedAt };
  // A parked run that filed its document is done with it, whenever this session first saw it.
  if (filed !== undefined) return readyOf(filed);
  return run.since === undefined
    ? { state: "starting" }
    : { state: "finished" };
}

/** The hand-off's run is still starting or at work, so its work is current. */
export function dispatchLive(dispatch: Dispatch, room: DispatchRoom): boolean {
  noteDispatch(room, dispatch);
  const { state } = dispatchStatus(dispatch, room);
  return state === "starting" || state === "working";
}

/** What a hand-off works on: "Constraints", "Quiet concept", "the app". */
export function subjectOf(dispatch: Dispatch): string | undefined {
  if (dispatch.concept !== undefined)
    return wording.design.conceptTitle(dispatch.concept);
  if (dispatch.kind !== undefined)
    return (
      wording.documentTab[dispatch.kind] ?? dispatch.kind.replaceAll("_", " ")
    );
  return text.subject[dispatch.tool];
}

const RUN_TOOL: Record<Role, string> = {
  writer: "deploy_writer",
  reviewer: "review_artifact",
  coder: "deploy_coder",
  designer: "design_app",
  presenter: "deploy_presenter",
};

/** A run at work the conversation has no hand-off for, such as one started before a reload. */
export function runDispatch(
  run: InFlightRun,
  kind: string | undefined,
): Dispatch {
  return {
    key: `run:${run.runId}`,
    call: `run:${run.runId}`,
    tool: RUN_TOOL[run.role],
    ...(kind === undefined ? {} : { kind }),
    role: run.role,
    runId: run.runId,
    pending: false,
    ...(run.concept === undefined ? {} : { concept: run.concept }),
  };
}
