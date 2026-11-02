import { expect, test } from "bun:test";
import {
  dispatchLive,
  dispatchStatus,
  dispatchesOf,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { workUnitMessage, workUnits } from "./work-unit.ts";

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
  approvals: [],
  activity: [],
});

const [coder] = dispatchesOf(
  {
    kind: "tool-trace",
    toolCallId: "call-coder",
    name: "deploy_coder",
    status: "output-available",
    input: { instruction: "Build it." },
  },
  { content: JSON.stringify({ runId: "run-coder" }), isError: false },
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

test("the hand-off's own step shows the approval wait instead of running", () => {
  const [unit] = workUnits([{ at: 100, dispatch: coder }], [], []).units;
  if (unit === undefined) throw new Error("no unit");
  const message = workUnitMessage(unit, { state: "approval" });
  const [step] = message.parts;
  expect(step).toMatchObject({
    kind: "tool-trace",
    toolCallId: "call-coder",
    status: "approval-requested",
  });
  // Nothing streams while the person is the one being waited on.
  expect(message.status).toBe("sent");
});
