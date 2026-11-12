/**
 * What a specialist run is producing right now, from its own run stream: the long text a tool call
 * is writing, else the model's words, else that it is thinking. Each frame repeats the whole
 * snapshot so far, so a late subscriber catches up on its first frame, and the preview is read
 * from the newest snapshot a few times a second rather than on every frame.
 */
import { useEffect, useRef, useState } from "react";
import {
  partialOf,
  subscribeWorkflowRun,
  type RunStreamEvent,
} from "../../api/run-stream.ts";

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

/**
 * The preview of each named run, streamed while it is named. A stream the hub refuses or drops shows
 * nothing for that run, so its card keeps its stage line.
 */
export function useRunPreviews(
  tenantId: string | undefined,
  runIds: readonly string[],
): ReadonlyMap<string, RunPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, RunPreview>>(
    () => new Map(),
  );
  const streams = useRef(
    new Map<
      string,
      { snapshot: Snapshot | undefined; unsubscribe: () => void }
    >(),
  );
  const timer = useRef<number | null>(null);
  const named = runIds.join("\n");

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

  return previews;
}
