import { expect, test } from "bun:test";
import { dispatchesOf } from "./dispatch-card.tsx";
import { specialistUpdate } from "./specialist-updates.ts";
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
