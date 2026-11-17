import { expect, test } from "bun:test";
import "./plugin-roles.testing.ts";
import { renderToStaticMarkup } from "react-dom/server";
import type { DispatchRoom } from "./dispatch-card.tsx";
import { RoomThread } from "./transcript.tsx";
import { workUnitStanding } from "./work-unit-step.model.ts";

test("each piece of work from one coordinator message has its own entry, on its own row", () => {
  const ended: DispatchRoom = {
    artifacts: [],
    inFlight: [],
    failed: [],
    seen: new Map(),
    ended: new Map([
      ["run-calm", { status: "completed" }],
      ["run-bold", { status: "completed" }],
    ]),
  };
  const html = renderToStaticMarkup(
    <RoomThread
      standing={(unit) => workUnitStanding(unit, ended)}
      results={
        new Map([
          [
            "call-mockups",
            {
              content: JSON.stringify({
                runs: [
                  { concept: "Calm", runId: "run-calm" },
                  { concept: "Bold", runId: "run-bold" },
                ],
              }),
              isError: false,
            },
          ],
        ])
      }
      turns={[
        { role: "person", text: "Show me two looks", at: 1 },
        {
          role: "assistant",
          text: "Two designers are on it.",
          at: 2,
          parts: [
            {
              kind: "tool-trace",
              toolCallId: "call-mockups",
              name: "execute",
              status: "output-available",
              input: {
                plugin: "designer",
                action: "mockup",
                input: {
                  concepts: [{ label: "Calm" }, { label: "Bold" }],
                },
              },
            },
            { kind: "text", text: "Two designers are on it." },
          ],
        },
      ]}
    />,
  );
  const ticks = [
    ...html.matchAll(
      /data-slot="conversation-map-tick" data-turn-id="([^"]*)"/g,
    ),
  ].map((match) => match[1]);
  expect(ticks).toEqual([
    "person:1:0",
    "work:call-mockups:Calm",
    "work:call-mockups:Bold",
  ]);
  for (const id of ticks) expect(html).toContain(`data-item-id="${id}"`);
});
