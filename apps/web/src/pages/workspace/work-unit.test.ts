import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunStep } from "@corbits-builder/schemas/activity";
import { wording } from "../../config.ts";
import {
  dispatchesOf,
  partsDispatches,
  runDispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { joinedSteps, savedResults, savedTurnSteps } from "./run-preview.ts";
import { WorkUnitStepView } from "./work-unit-step.view.tsx";
import { specialistUpdate } from "./specialist-updates.ts";
import { workUnitStanding } from "./work-unit-step.model.ts";
import { workUnits } from "./work-unit.ts";

test("a hand-off and its reports join as one piece of work", () => {
  const approaches = dispatchesOf(
    {
      kind: "tool-trace",
      toolCallId: "call-approaches",
      name: "execute",
      status: "output-available",
      input: {
        plugin: "writer",
        action: "write",
        input: { kind: "approaches", instruction: "Compare three ways in." },
      },
    },
    {
      content: JSON.stringify({
        started: true,
        plugin: "writer",
        action: "write",
        runs: [{ runId: "run-approaches" }],
      }),
      isError: false,
    },
  );
  const concepts = dispatchesOf(
    {
      kind: "tool-trace",
      toolCallId: "call-concepts",
      name: "execute",
      status: "output-available",
      input: {
        plugin: "designer",
        action: "mockup",
        input: {
          concepts: [
            { label: "Quiet", direction: "Calm" },
            { label: "Bold", direction: "Loud" },
          ],
        },
      },
    },
    {
      content: JSON.stringify({
        started: true,
        plugin: "designer",
        action: "mockup",
        runs: [
          { concept: "Quiet", runId: "run-quiet" },
          { concept: "Bold", runId: "run-bold" },
        ],
      }),
      isError: false,
    },
  );
  const report = specialistUpdate(
    "writer",
    JSON.stringify({ result: { summary: "Approaches filed." } }),
    200,
  );
  const designerReport = specialistUpdate("designer", "Quiet is drafted.", 500);
  if (report === null || designerReport === null) throw new Error("no report");

  const work = workUnits(
    [
      ...approaches.map((dispatch) => ({ at: 100, dispatch })),
      ...concepts.map((dispatch) => ({ at: 400, dispatch })),
    ],
    [report, designerReport],
  );

  const [unit] = work.units;
  expect(work.units.map((item) => item.key)).toEqual([
    "call-approaches",
    "call-concepts:Quiet",
    "call-concepts:Bold",
  ]);
  expect(unit?.updates).toEqual([report]);
  expect(unit?.at).toBe(200);
  // Two designers started together, so this answers no one hand-off.
  expect(work.updates).toEqual([designerReport]);
});

test("a run's saved calls are its steps before its stream says anything", () => {
  const run = {
    runId: "run-coder",
    role: "coder" as const,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "running" as const,
    state: "working" as const,
  };
  const recorded = [
    {
      callId: "call-read",
      name: "read_file",
      arguments: { path: "docs/brief.md" },
      at: 100,
      result: { content: "# Brief", isError: false },
    },
    {
      callId: "call-write",
      name: "write_file",
      arguments: { path: "src/app.tsx" },
      at: 100,
      result: { content: "Wrote 120 bytes", isError: false },
    },
  ];
  const [unit] = workUnits([{ at: 100, dispatch: runDispatch(run) }], []).units;
  if (unit === undefined) throw new Error("no work");

  const { steps } = workUnitStanding(unit, {
    artifacts: [],
    inFlight: [run],
    failed: [],
    seen: new Map(),
    steps: new Map([[run.runId, joinedSteps(recorded, [])]]),
  });

  expect(steps).toEqual([
    {
      kind: "tool-trace",
      toolCallId: "call-read",
      name: "read_file",
      status: "output-available",
      input: { path: "docs/brief.md" },
    },
    {
      kind: "tool-trace",
      toolCallId: "call-write",
      name: "write_file",
      status: "output-available",
      input: { path: "src/app.tsx" },
    },
  ]);
});

// The coordinator's saved call that started a coder, as its saved conversation keeps it.
const buildCall: RunStep = {
  callId: "call-build",
  name: "execute",
  arguments: {
    plugin: "coder",
    action: "build",
    input: { instruction: "Build the app." },
  },
  at: 10,
  result: {
    content: JSON.stringify({ started: true, runs: [{ runId: "run-build" }] }),
    isError: false,
  },
};

const buildUnit = () => {
  const parts = savedTurnSteps([buildCall], [10]).get(10) ?? [];
  const [dispatch] = partsDispatches(parts, savedResults([buildCall]));
  if (dispatch === undefined) throw new Error("no hand-off");
  const [unit] = workUnits([{ at: 10, dispatch }], []).units;
  if (unit === undefined) throw new Error("no work");
  return unit;
};

const emptyRoom: DispatchRoom = {
  artifacts: [],
  inFlight: [],
  failed: [],
  seen: new Map(),
};

test("after a reload an ended run's row keeps its run id from the saved conversation and lists its steps", () => {
  const unit = buildUnit();
  expect(unit.dispatch.runId).toBe("run-build");
  const { steps } = workUnitStanding(unit, {
    ...emptyRoom,
    steps: new Map([
      [
        "run-build",
        joinedSteps(
          [
            {
              callId: "call-test",
              name: "run_shell",
              arguments: { command: "bun test" },
              at: 20,
              result: { content: "3 pass", isError: false },
            },
          ],
          [],
        ),
      ],
    ]),
  });
  expect(steps.map((step) => step.toolCallId)).toEqual(["call-test"]);
});

const render = (
  room: DispatchRoom,
): { html: string; state: string; stop: boolean } => {
  const standing = workUnitStanding(buildUnit(), room);
  return {
    html: renderToStaticMarkup(
      createElement(WorkUnitStepView, { ...standing, run: () => null }),
    ),
    state: standing.status.state,
    stop: standing.stop !== undefined,
  };
};

test("a stopped run reads Stopped and a failed one says it did not finish, both quietly", () => {
  const stopped = render({
    ...emptyRoom,
    ended: new Map([["run-build", { status: "cancelled" }]]),
  });
  expect(stopped.state).toBe("stopped");
  expect(stopped.html).toContain(`>${wording.dispatch.stopped}<`);
  expect(stopped.html).not.toContain(
    `>${wording.dispatch.status["output-available"]}<`,
  );

  const failed = render({
    ...emptyRoom,
    ended: new Map([
      [
        "run-build",
        { status: "failed", error: "the sandbox ran out of memory" },
      ],
    ]),
  });
  expect(failed.state).toBe("failed");
  expect(failed.html).toContain(`>${wording.dispatch.status.error}<`);
  expect(failed.html).toContain("the sandbox ran out of memory");
  expect(failed.html).not.toContain("text-destructive");
});

test("only a working specialist's row offers Stop", () => {
  const onStop = async () => {};
  const working = render({
    ...emptyRoom,
    inFlight: [
      {
        runId: "run-build",
        role: "coder",
        startedAt: new Date(10).toISOString(),
        status: "running",
        state: "working",
        since: new Date(10).toISOString(),
      },
    ],
    onStop,
  });
  expect(working.stop).toBe(true);
  expect(working.html).toContain(`>${wording.dispatch.stop}<`);

  const finished = render({ ...emptyRoom, onStop });
  expect(finished.state).toBe("finished");
  expect(finished.stop).toBe(false);
  expect(finished.html).not.toContain(`>${wording.dispatch.stop}<`);

  const stopped = render({
    ...emptyRoom,
    ended: new Map([["run-build", { status: "cancelled" }]]),
    onStop,
  });
  expect(stopped.stop).toBe(false);
});
