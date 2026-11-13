import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { filedDispatches, type DispatchRoom } from "./dispatch-card.tsx";
import { RoomThread } from "./transcript.tsx";
import { workUnitStanding } from "./work-unit-step.model.ts";

const room: DispatchRoom = {
  artifacts: [
    {
      artifactId: "11111111-1111-4111-8111-111111111111",
      kind: "product_requirements",
      title: "Todo Requirements",
      version: 1,
      sha256: "0".repeat(64),
      filedAt: new Date(20).toISOString(),
    },
  ],
  inFlight: [],
  failed: [],
  seen: new Map(),
};

describe("conversation map", () => {
  test("a filed document and an answered approval follow the person's message", () => {
    const html = renderToStaticMarkup(
      <RoomThread
        standing={(unit) => workUnitStanding(unit, room)}
        turns={[{ role: "person", text: "Make a todo app", at: 1 }]}
        runs={filedDispatches(room, [], [])}
        approvals={[
          {
            approvalId: "appr-1",
            toolName: "run_shell",
            subject: "bun run build",
            at: 30,
            outcome: { status: "approved" },
          },
        ]}
      />,
    );
    const ticks = [
      ...html.matchAll(
        /data-slot="conversation-map-tick" data-turn-id="[^"]*"(?: data-visible="")? aria-label="([^"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(ticks).toEqual([
      "Make a todo app",
      "Requirements v1",
      "Let the specialist use run shell on bun run build? · Answered",
    ]);
  });
});
