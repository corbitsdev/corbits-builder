import { expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import {
  dispatchLive,
  dispatchStatus,
  dispatchesOf,
  type DispatchRoom,
  type RunEnd,
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

test("a run with an open approval reads as waiting for the person, with what it asked, before its own state catches up", () => {
  const waiting: DispatchRoom = {
    ...room("working"),
    asked: new Map([["run-coder", "installing zod, exceljs"]]),
  };
  expect(dispatchStatus(coder, waiting)).toEqual({
    state: "approval",
    asked: "installing zod, exceljs",
  });
});

test("a run that ended on a block reads as blocked with its reason, not as stopped or failed", () => {
  const ended = (end: RunEnd): DispatchRoom => ({
    artifacts: [],
    inFlight: [],
    failed: [],
    seen: new Map(),
    ended: new Map([["run-coder", end]]),
  });
  expect(dispatchStatus(coder, ended({ status: "cancelled" }))).toEqual({
    state: "stopped",
  });
  const blocked = { reason: "The hub refused every file write." };
  expect(
    dispatchStatus(coder, ended({ status: "cancelled", blocked })),
  ).toEqual({ state: "blocked", reason: blocked.reason });
  // Builder's end of a blocked run can itself fail; the block is still what happened.
  expect(
    dispatchStatus(coder, ended({ status: "failed", error: "x", blocked })),
  ).toEqual({ state: "blocked", reason: blocked.reason });
  expect(dispatchLive(coder, ended({ status: "cancelled", blocked }))).toBe(
    false,
  );
});
