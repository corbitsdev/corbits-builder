import { expect, test } from "bun:test";
import { subscribeWorkflowRun, type RunStreamSource } from "./run-stream.ts";

test("a dropped stream says so, retries, and a reopen reports the gap", () => {
  const sources: {
    url: string;
    listeners: Map<string, (event: { data: string }) => void>;
  }[] = [];
  const timers: (() => void)[] = [];
  const seen: string[] = [];
  const subscription = subscribeWorkflowRun(
    "tenant",
    "run_1",
    {
      onEvent: (event) => seen.push(event.type),
      onChange: () => seen.push("change"),
      onReconnect: () => seen.push("reconnect"),
      onError: () => seen.push("error"),
    },
    {
      createEventSource: (url): RunStreamSource => {
        const listeners = new Map<string, (event: { data: string }) => void>();
        sources.push({ url, listeners });
        return {
          addEventListener: (type, listener) => listeners.set(type, listener),
          close() {},
        };
      },
      setTimeout: (callback) => timers.push(callback),
      clearTimeout: () => {},
    },
  );
  const first = sources[0]!;
  expect(first.url).toEndWith(
    "/api/tenants/tenant/workflows/runs/run_1/stream",
  );
  first.listeners.get("open")?.({ data: "" });
  first.listeners.get("run")?.({
    data: JSON.stringify({ type: "inference.start" }),
  });
  first.listeners.get("mail")?.({ data: "{}" });
  first.listeners.get("error")?.({ data: "" });
  timers.shift()?.();
  sources[1]?.listeners.get("open")?.({ data: "" });
  subscription.unsubscribe();
  sources[1]?.listeners.get("run")?.({
    data: JSON.stringify({ type: "inference.done" }),
  });
  expect(seen).toEqual(["inference.start", "change", "error", "reconnect"]);
});
