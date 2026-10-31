/**
 * Live workflow-run events from the hub SSE route
 * (`GET /api/tenants/:tenantId/workflows/runs/:runId/stream`).
 *
 * `run` frames are native InferenceEvents. A text delta's `partial.text` is
 * the model output so far for that call. `inference.done` means that call
 * finished; the durable conversation mirror is a separate read. `mail` and
 * `status` frames say the room's durable state moved (mail delivered for the
 * run, or its sidecar route lost) without carrying that state.
 */
import { hubEventSourceCredentials, hubOrigin } from "./origin.ts";
import { openSharedEventSource } from "../shared-event-source.ts";

export type RunStreamEvent = {
  type: string;
  seq?: number;
  data?: {
    partial?: {
      text?: string;
      thinking?: string;
      toolCalls?: readonly {
        id?: unknown;
        name?: unknown;
        partialArguments?: unknown;
      }[];
    };
    callId?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
};

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export function nextRunStreamBackoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Fold one native frame into the in-progress assistant text. */
export function applyRunStreamEvent(
  live: string,
  event: RunStreamEvent,
): { live: string; refresh: boolean } {
  if (event.type === "inference.start") return { live: "", refresh: false };
  if (event.type === "inference.text.delta") {
    const text = event.data?.partial?.text ?? "";
    return { live: text.length > 0 ? text : live, refresh: false };
  }
  if (event.type === "inference.error") return { live: "", refresh: true };
  if (event.type === "inference.done") return { live, refresh: true };
  return { live, refresh: false };
}

export type RunStreamSource = {
  addEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ): void;
  close(): void;
};

export type SubscribeRunStreamDeps = {
  createEventSource: (url: string, withCredentials: boolean) => RunStreamSource;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

const defaultDeps: SubscribeRunStreamDeps = {
  createEventSource: (url, withCredentials) =>
    openSharedEventSource(url, withCredentials),
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

export type RunStreamHandlers = {
  onEvent: (event: RunStreamEvent) => void;
  /** A `mail` or `status` frame: durable room state moved. */
  onChange?: () => void;
  /** The stream opened again after a drop or a hidden tab; frames in between were missed. */
  onReconnect?: () => void;
  /** The stream dropped. The run it named may have been replaced. */
  onError?: () => void;
};

export function subscribeWorkflowRun(
  tenantId: string,
  runId: string,
  handlers: RunStreamHandlers,
  deps: SubscribeRunStreamDeps = defaultDeps,
): { unsubscribe: () => void } {
  let closed = false;
  let opened = false;
  let attempt = 0;
  let source: RunStreamSource | null = null;
  let retryHandle: number | null = null;

  const connect = () => {
    if (closed) return;
    const url = `${hubOrigin()}/api/tenants/${encodeURIComponent(tenantId)}/workflows/runs/${encodeURIComponent(runId)}/stream`;
    const es = deps.createEventSource(url, hubEventSourceCredentials());
    source = es;
    es.addEventListener("open", () => {
      if (closed) return;
      attempt = 0;
      if (opened) handlers.onReconnect?.();
      opened = true;
    });
    es.addEventListener("run", (message) => {
      if (closed) return;
      let event: RunStreamEvent;
      try {
        event = JSON.parse(message.data) as RunStreamEvent;
      } catch {
        // A frame that is not JSON is not a run event.
        return;
      }
      handlers.onEvent(event);
    });
    for (const type of ["mail", "status"]) {
      es.addEventListener(type, () => {
        if (!closed) handlers.onChange?.();
      });
    }
    es.addEventListener("error", () => {
      if (closed) return;
      es.close();
      handlers.onError?.();
      const delay = nextRunStreamBackoffMs(attempt);
      attempt += 1;
      retryHandle = deps.setTimeout(connect, delay);
    });
  };

  connect();

  return {
    unsubscribe: () => {
      closed = true;
      if (retryHandle !== null) deps.clearTimeout(retryHandle);
      source?.close();
    },
  };
}
