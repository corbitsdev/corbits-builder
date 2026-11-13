/**
 * What a specialist run is doing, from its own run stream: each tool call it makes, in order, and
 * what it is producing right now, the long text a tool call is writing, else the model's words,
 * else that it is thinking. Each frame repeats the whole snapshot so far, so a late subscriber
 * catches up on the preview on its first frame; the stream does not replay calls made before it
 * opened, so those are read once from the run's saved conversation. Both are read a few times a
 * second rather than on every frame.
 */
import { useEffect, useRef, useState } from "react";
import { queryOptions, useQueries } from "@tanstack/react-query";
import type { PartTool } from "@corbits/react-ui";
import type { RunStep } from "@corbits-builder/schemas/activity";
import { readRunSteps } from "../../api/activity.ts";
import {
  partialOf,
  subscribeWorkflowRun,
  type RunStreamEvent,
} from "../../api/run-stream.ts";
import { keys } from "../../queries/keys.ts";
import { finishedCallOf } from "./conversation-parts.ts";
import type { RunEnd } from "./dispatch-card.tsx";
import { resultOf, type CallResult } from "./live-run.ts";

export type RunPreview =
  | { readonly kind: "writing"; readonly text: string }
  | { readonly kind: "thinking" };

type Snapshot = NonNullable<ReturnType<typeof partialOf>>;

// A tool argument this long, or running over lines, is the work itself rather than a name or a path.
const LONG_ARGUMENT = 80;
const FLUSH_MS = 250;

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * One JSON string from just after its opening quote, as far as it has arrived: an escape cut off at
 * the end is left out until the rest of it arrives.
 */
function readString(json: string, from: number) {
  let value = "";
  let index = from;
  while (index < json.length) {
    const char = json.charAt(index);
    if (char === '"') return { value, end: index + 1 };
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }
    const code = json[index + 1];
    if (code === undefined) break;
    if (code === "u") {
      const hex = json.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 6;
      continue;
    }
    value += ESCAPES[code] ?? code;
    index += 2;
  }
  return { value, end: json.length };
}

/** Every string value in JSON that may stop anywhere, keys left out, in order. */
export function partialStringValues(json: string): string[] {
  const values: string[] = [];
  const open: string[] = [];
  let key = false;
  let index = 0;
  while (index < json.length) {
    const char = json.charAt(index);
    if (char === '"') {
      const read = readString(json, index + 1);
      if (!key) values.push(read.value);
      key = false;
      index = read.end;
      continue;
    }
    if (char === "{" || char === "[") open.push(char);
    else if (char === "}" || char === "]") open.pop();
    if (char === "{") key = true;
    else if (char === ",") key = open.at(-1) === "{";
    else if (char === ":" || char === "[") key = false;
    index += 1;
  }
  return values;
}

/** The longest text a tool call's arguments carry so far, when it is long enough to be the work. */
function longArgument(partialArguments: unknown): string | undefined {
  if (typeof partialArguments !== "string") return undefined;
  const longest = partialStringValues(partialArguments).reduce(
    (found, value) => (value.length > found.length ? value : found),
    "",
  );
  return longest.length >= LONG_ARGUMENT || longest.includes("\n")
    ? longest
    : undefined;
}

/** What one inference snapshot shows: the newest call's long argument, else the words, else thinking. */
export function previewOf(partial: Snapshot): RunPreview | undefined {
  const calls = partial.toolCalls ?? [];
  for (const call of [...calls].reverse()) {
    const text = longArgument(call.partialArguments);
    if (text !== undefined) return { kind: "writing", text };
  }
  if (partial.text !== undefined && partial.text.trim() !== "")
    return { kind: "writing", text: partial.text };
  if (partial.thinking !== undefined && partial.thinking.trim() !== "")
    return { kind: "thinking" };
  return undefined;
}

/** The snapshot a frame leaves: a model call that starts or ends clears it, a delta replaces it. */
function nextSnapshot(
  current: Snapshot | undefined,
  event: RunStreamEvent,
): Snapshot | undefined {
  if (
    event.type === "inference.start" ||
    event.type === "inference.done" ||
    event.type === "inference.error"
  )
    return undefined;
  return partialOf(event) ?? current;
}

const done = (step: PartTool): PartTool => ({
  kind: "tool-trace",
  toolCallId: step.toolCallId,
  name: step.name,
  status: "output-available",
  input: step.input,
});

/**
 * A run's calls after one frame: a finished call joins once, as running, and is done once its
 * result comes back, or once the next model call starts, which waits on every call before it. A
 * call that returned an error settles the same way: the specialist corrects it, and a shown step
 * never leaves the list.
 */
function nextSteps(
  steps: readonly PartTool[],
  event: RunStreamEvent,
): readonly PartTool[] {
  if (event.type === "inference.start")
    return steps.map((step) => (step.status === "running" ? done(step) : step));
  if (event.type === "tool.done") {
    const callId = resultOf(event)?.callId;
    return steps.map((step) =>
      step.toolCallId === callId && step.status === "running"
        ? done(step)
        : step,
    );
  }
  if (event.type !== "inference.tool_call.end") return steps;
  const call = finishedCallOf(event.data);
  if (
    call === undefined ||
    steps.some((step) => step.toolCallId === call.callId)
  )
    return steps;
  return [
    ...steps,
    {
      kind: "tool-trace",
      toolCallId: call.callId,
      name: call.name,
      status: "running",
      input: call.arguments,
    },
  ];
}

/**
 * A run's calls: those it saved, in the order it made them, then those its stream added since. A
 * call in both stands where it was saved, as the stream last showed it once it returned.
 */
export function joinedSteps(
  saved: readonly RunStep[],
  live: readonly PartTool[],
): PartTool[] {
  const streamed = new Map(live.map((step) => [step.toolCallId, step]));
  const known = new Set(saved.map((step) => step.callId));
  return [
    ...saved.map((step): PartTool => {
      const seen = streamed.get(step.callId);
      if (seen !== undefined && seen.status !== "running") return seen;
      return savedPart(step);
    }),
    ...live.filter((step) => !known.has(step.toolCallId)),
  ];
}

const savedPart = (step: RunStep): PartTool => ({
  kind: "tool-trace",
  toolCallId: step.callId,
  name: step.name,
  status: step.result === undefined ? "running" : "output-available",
  input: step.arguments,
});

/** What each saved call returned, by its call id. */
export function savedResults(
  steps: readonly RunStep[],
): Map<string, CallResult> {
  return new Map(
    steps.flatMap((step): [string, CallResult][] =>
      step.result === undefined ? [] : [[step.callId, step.result]],
    ),
  );
}

/**
 * A run's saved calls under the saved replies they led to, by each reply's time: a call stands
 * under the first reply saved with or after it. The saved conversation keeps only the replies' words,
 * so this is what lets the coordinator's replies keep their steps after a reload.
 */
export function savedTurnSteps(
  steps: readonly RunStep[],
  replies: readonly number[],
): Map<number, PartTool[]> {
  const sorted = replies.toSorted((left, right) => left - right);
  const byReply = new Map<number, PartTool[]>();
  for (const step of steps) {
    const reply = sorted.find((at) => at >= step.at);
    if (reply === undefined) continue;
    byReply.set(reply, [...(byReply.get(reply) ?? []), savedPart(step)]);
  }
  return byReply;
}

/** The calls one run saved, read once: a run's calls only grow, and its stream adds them. */
export function runStepsQuery(tenantId: string, runId: string) {
  return queryOptions({
    queryKey: keys.runSteps(tenantId, runId),
    queryFn: ({ signal }) => readRunSteps(tenantId, runId, signal),
    refetchOnWindowFocus: false,
    // Arguments can carry whole files, so they are not kept across reloads.
    meta: { persist: false },
  });
}

const NO_STEPS: readonly RunStep[] = [];

/** The calls one run saved, and whether the first read of them is still under way. */
export function useSavedRunSteps(
  tenantId: string | undefined,
  runId: string | null,
): { pending: boolean; steps: readonly RunStep[] } {
  const named =
    tenantId === undefined || runId === null ? [] : [{ tenantId, runId }];
  const [read] = useQueries({
    queries: named.map((run) => runStepsQuery(run.tenantId, run.runId)),
  });
  return {
    pending: read?.isPending === true,
    steps: read?.data?.steps ?? NO_STEPS,
  };
}

/**
 * The preview of each streamed run while it is named, and the calls of every shown run: those it
 * saved before this room saw it, read once when its card is first shown, then every call its
 * stream added, kept after the stream closes so finished work still lists its steps. What each call
 * returned comes the same two ways, and how each shown run ended from its saved record. A stream the
 * hub refuses or drops shows no preview for that run.
 */
export function useRunStreams(
  tenantId: string | undefined,
  runIds: readonly string[],
  shownRunIds: readonly string[],
): {
  previews: ReadonlyMap<string, RunPreview>;
  steps: ReadonlyMap<string, readonly PartTool[]>;
  results: ReadonlyMap<string, CallResult>;
  ended: ReadonlyMap<string, RunEnd>;
} {
  const [previews, setPreviews] = useState<ReadonlyMap<string, RunPreview>>(
    () => new Map(),
  );
  const [steps, setSteps] = useState<ReadonlyMap<string, readonly PartTool[]>>(
    () => new Map(),
  );
  const [liveResults, setLiveResults] = useState<
    ReadonlyMap<string, CallResult>
  >(() => new Map());
  const calls = useRef(new Map<string, readonly PartTool[]>());
  const returned = useRef(new Map<string, CallResult>());
  const streams = useRef(
    new Map<
      string,
      { snapshot: Snapshot | undefined; unsubscribe: () => void }
    >(),
  );
  const timer = useRef<number | null>(null);
  const named = runIds.join("\n");
  const saved = useQueries({
    queries:
      tenantId === undefined
        ? []
        : shownRunIds.map((runId) => runStepsQuery(tenantId, runId)),
  });

  useEffect(() => {
    const open = streams.current;
    const flush = () => {
      timer.current = null;
      const next = new Map<string, RunPreview>();
      for (const [runId, stream] of open) {
        const preview =
          stream.snapshot === undefined
            ? undefined
            : previewOf(stream.snapshot);
        if (preview !== undefined) next.set(runId, preview);
      }
      setPreviews(next);
      setSteps(new Map(calls.current));
      setLiveResults(new Map(returned.current));
    };
    const schedule = () => {
      timer.current ??= window.setTimeout(flush, FLUSH_MS);
    };
    const wanted = new Set(
      tenantId === undefined ? [] : named.split("\n").filter(Boolean),
    );
    for (const [runId, stream] of open) {
      if (wanted.has(runId)) continue;
      stream.unsubscribe();
      open.delete(runId);
      schedule();
    }
    if (tenantId === undefined) return;
    for (const runId of wanted) {
      if (open.has(runId)) continue;
      const stream: {
        snapshot: Snapshot | undefined;
        unsubscribe: () => void;
      } = {
        snapshot: undefined,
        unsubscribe: () => {},
      };
      open.set(runId, stream);
      stream.unsubscribe = subscribeWorkflowRun(tenantId, runId, {
        onEvent: (event) => {
          stream.snapshot = nextSnapshot(stream.snapshot, event);
          calls.current.set(
            runId,
            nextSteps(calls.current.get(runId) ?? [], event),
          );
          const result =
            event.type === "tool.done" ? resultOf(event) : undefined;
          if (result !== undefined)
            returned.current.set(result.callId, {
              isError: result.isError,
              content: result.content,
            });
          schedule();
        },
        onError: () => {
          stream.snapshot = undefined;
          schedule();
        },
      }).unsubscribe;
    }
  }, [tenantId, named]);

  // Closes every stream when the room unmounts.
  useEffect(() => {
    const open = streams.current;
    return () => {
      for (const stream of open.values()) stream.unsubscribe();
      open.clear();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const joined = new Map(steps);
  const results = new Map<string, CallResult>();
  const ended = new Map<string, RunEnd>();
  shownRunIds.forEach((runId, index) => {
    const record = saved[index]?.data;
    if (record === undefined) return;
    joined.set(runId, joinedSteps(record.steps, steps.get(runId) ?? []));
    for (const [callId, result] of savedResults(record.steps))
      results.set(callId, result);
    ended.set(runId, record);
  });
  for (const [callId, result] of liveResults) results.set(callId, result);
  return { previews, steps: joined, results, ended };
}
