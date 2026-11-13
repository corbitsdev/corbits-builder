import { expect, test } from "bun:test";
import { createElement } from "react";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunStep } from "@corbits-builder/schemas/activity";
import { wording } from "../../config.ts";
import {
  dispatchesOf,
  filedDispatches,
  partsDispatches,
  runDispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import { committedSteps, emptyLiveRun, foldLiveRun } from "./live-run.ts";
import {
  joinedSteps,
  runStepsQuery,
  savedResults,
  savedTurnSteps,
  streamedRuns,
} from "./run-preview.ts";
import { WorkUnitStepView, watchClipping } from "./work-unit-step.view.tsx";
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

  const finished = render({
    ...emptyRoom,
    ended: new Map([["run-build", { status: "completed" }]]),
    onStop,
  });
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

// A coder's run the coordinator just started: its call returned, the room's last read predates it.
const changeCall = (runId: string) =>
  dispatchesOf(
    {
      kind: "tool-trace",
      toolCallId: "call-change",
      name: "execute",
      status: "output-available",
      input: {
        plugin: "coder",
        action: "change",
        input: { instruction: "Use Arial." },
      },
    },
    {
      content: JSON.stringify({ started: true, runs: [{ runId }] }),
      isError: false,
    },
  );

const app = {
  artifactId: "22222222-2222-4222-8222-222222222222",
  kind: "app",
  title: "Weather",
  version: 1,
  sha256: "0".repeat(64),
  filedAt: new Date(5).toISOString(),
};

test("a run is streamed as soon as its record says it has not ended, before the room lists it at work", () => {
  expect(
    streamedRuns(
      [
        { runId: "run-new", status: "deployed" },
        { runId: "run-parked", status: "running" },
        { runId: "run-done", status: "completed" },
        { runId: "run-unread", status: undefined },
      ],
      new Set(["run-parked"]),
    ),
  ).toEqual(["run-new"]);
});

test("a working run's saved calls are read again until it ends, so a call made before its stream opened shows", () => {
  const client = new QueryClient();
  const options = runStepsQuery("tenant", "run-coder", true);
  const query = client.getQueryCache().build(client, options);
  const interval = (status: string) => {
    query.setData({ status, steps: [] });
    if (typeof options.refetchInterval !== "function")
      throw new Error("no polling");
    return options.refetchInterval(query);
  };
  expect(interval("running")).toBeGreaterThan(0);
  expect(interval("completed")).toBe(false);
});

test("after a reload a finished writer's row still opens what it filed", () => {
  const [writer] = dispatchesOf(
    {
      kind: "tool-trace",
      toolCallId: "call-requirements",
      name: "execute",
      status: "output-available",
      input: {
        plugin: "writer",
        action: "write-requirements",
        input: { instruction: "An echo tool." },
      },
    },
    {
      content: JSON.stringify({ started: true, runs: [{ runId: "run-w" }] }),
      isError: false,
    },
  );
  if (writer === undefined) throw new Error("no hand-off");
  const [unit] = workUnits([{ at: 10, dispatch: writer }], []).units;
  if (unit === undefined) throw new Error("no work");
  const standing = workUnitStanding(unit, {
    ...emptyRoom,
    artifacts: [
      {
        ...app,
        kind: "product_requirements",
        title: "Echo Requirements",
      },
    ],
    ended: new Map([["run-w", { status: "completed" }]]),
    onOpenDocument: () => {},
  });
  expect(standing.status.state).toBe("ready");
  expect(
    renderToStaticMarkup(
      createElement(WorkUnitStepView, { ...standing, run: () => null }),
    ),
  ).toContain(`>${wording.dispatch.open}<`);
});

test("a coder whose call returned is starting until its own run says otherwise, whatever is already filed", () => {
  const [change] = changeCall("run-change");
  if (change === undefined) throw new Error("no hand-off");
  const room = { ...emptyRoom, artifacts: [app] };
  const [unit] = workUnits([{ at: 10, dispatch: change }], []).units;
  if (unit === undefined) throw new Error("no work");
  expect(workUnitStanding(unit, room).status.state).toBe("starting");
  const deployed = workUnitStanding(unit, {
    ...room,
    inFlight: [
      {
        runId: "run-change",
        role: "coder",
        startedAt: new Date(10).toISOString(),
        status: "deployed",
        state: "waiting",
      },
    ],
  });
  expect(deployed.status.state).toBe("starting");
  expect(deployed.label).toBe("Coder · Changing the code");
});

test("a call that started a specialist stays with the words it led to when the next run starts first", () => {
  const live = [
    { type: "message.run.started" },
    { type: "inference.start" },
    {
      type: "inference.tool_call.end",
      data: {
        callId: "call-change",
        name: "execute",
        arguments: { plugin: "coder", action: "change", input: {} },
      },
    },
    { type: "inference.done" },
    { type: "inference.start" },
    {
      type: "inference.text.delta",
      data: { partial: { text: "The coder is on it." } },
    },
    { type: "inference.done" },
    { type: "message.run.ended" },
    { type: "message.run.started" },
  ].reduce((run, event) => foldLiveRun(run, event, null).run, emptyLiveRun);
  const steps = committedSteps(live, [
    { role: "assistant", text: "The coder is on it.", at: 50 },
  ]);
  expect(steps.get(50)?.map((part) => part.kind)).toEqual(["tool-trace"]);
});

test("a design saved from the font screen reads as the fonts picked, not as a mockup", () => {
  const room: DispatchRoom = {
    ...emptyRoom,
    artifacts: [
      {
        ...app,
        kind: "design",
        title: "Weather design",
        version: 2,
        filedAt: new Date(40).toISOString(),
      },
    ],
    screens: [{ at: 30, action: "designer pick-fonts" }],
  };
  const [filed] = filedDispatches(room, [], []);
  if (filed === undefined) throw new Error("no row");
  const [unit] = workUnits([filed], []).units;
  if (unit === undefined) throw new Error("no work");
  expect(workUnitStanding(unit, room).label).toBe(
    "Designer · Picked the fonts",
  );
});

test("a report says More only while its text overflows, measured again whenever its box changes size", () => {
  const box = { scrollHeight: 63, clientHeight: 42 };
  const seen: boolean[] = [];
  let resize = () => {};
  watchClipping(
    box,
    (clipped) => seen.push(clipped),
    (_box, measure) => {
      resize = measure;
      return () => {};
    },
  );
  box.scrollHeight = 21;
  resize();
  expect(seen).toEqual([true, false]);
});
