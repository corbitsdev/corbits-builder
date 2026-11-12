import { expect, test } from "bun:test";
import { dispatchesOf } from "./dispatch-card.tsx";
import { specialistUpdate } from "./specialist-updates.ts";
import { workUnitMessage, workUnits } from "./work-unit.ts";

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
    { content: JSON.stringify({ runId: "run-approaches" }), isError: false },
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
      content: JSON.stringify([
        { concept: "Quiet", runId: "run-quiet" },
        { concept: "Bold", runId: "run-bold" },
      ]),
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
    [
      {
        approvalId: "approval-packages",
        toolName: "install_packages",
        packages: ["zod"],
        at: 600,
      },
    ],
  );

  const [unit] = work.units;
  expect(work.units.map((item) => item.key)).toEqual([
    "call-approaches",
    "call-concepts:Quiet",
    "call-concepts:Bold",
  ]);
  expect(unit?.updates).toEqual([report]);
  expect(unit?.at).toBe(200);
  // Two designers started together and no coder was handed work, so these answer no one hand-off.
  expect(work.updates).toEqual([designerReport]);
  expect(work.approvals.map((item) => item.approvalId)).toEqual([
    "approval-packages",
  ]);

  if (unit === undefined) throw new Error("no unit");
  const message = workUnitMessage(unit, { state: "finished" });
  expect(message.author).toMatchObject({ kind: "agent", id: "writer" });
});
