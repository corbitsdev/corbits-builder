import { expect, test } from "bun:test";
import { dispatchesOf, runDispatch } from "./dispatch-card.tsx";
import { joinedSteps } from "./run-preview.ts";
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
      returned: true,
    },
    {
      callId: "call-write",
      name: "write_file",
      arguments: { path: "src/app.tsx" },
      returned: true,
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
