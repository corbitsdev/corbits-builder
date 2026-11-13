import { expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import {
  dispatchLive,
  dispatchStatus,
  dispatchesOf,
  type DispatchRoom,
} from "./dispatch-card.tsx";

const room = (state: "working" | "waiting" | "approval"): DispatchRoom => ({
  artifacts: [],
  inFlight: [
    {
      runId: "run-coder",
      role: "coder",
      startedAt: "2026-11-02T01:41:25.000Z",
      status: "running",
      state,
      since: "2026-11-02T01:41:30.000Z",
    },
  ],
  failed: [],
  seen: new Map(),
});

const [coder] = dispatchesOf(
  {
    kind: "tool-trace",
    toolCallId: "call-coder",
    name: "execute",
    status: "output-available",
    input: {
      plugin: "coder",
      action: "build",
      input: { instruction: "Build it." },
    },
  },
  {
    content: JSON.stringify({
      started: true,
      plugin: "coder",
      action: "build",
      runs: [{ runId: "run-coder" }],
    }),
    isError: false,
  },
);
if (coder === undefined) throw new Error("no dispatch");

test("a run held on an approval reads as paused for the person, not as at work", () => {
  expect(dispatchStatus(coder, room("working"))).toEqual({
    state: "working",
    since: "2026-11-02T01:41:30.000Z",
  });
  expect(dispatchStatus(coder, room("approval"))).toEqual({
    state: "approval",
  });
  // Its work is still current: a document it builds from should not change under it.
  expect(dispatchLive(coder, room("approval"))).toBe(true);
});
