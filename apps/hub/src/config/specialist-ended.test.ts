import { expect, test } from "bun:test";
import { HUB_NOTE_LEAD } from "./resume.ts";
import { specialistEndedMessage } from "./specialist-ended.ts";

const ended = {
  runId: "run-1",
  action: { plugin: "designer", action: "change" },
  lastCalls: ["- write_file {}\n  returned: error: refused"],
  agentDecides: true,
};

test("a blocked run's note leads with the block and tells the coordinator not to start it again", () => {
  const blocked = {
    reason: "The hub refuses every write to the design.",
    tried: "Writing the stylesheet, then checking the design.",
  };
  // Builder's end of a blocked run is a stop, or a failure when the stop was refused.
  for (const status of ["cancelled", "failed"] as const) {
    const note = specialistEndedMessage({
      ...ended,
      status,
      reason: { message: "blocked" },
      blocked,
    });
    const [line, ...rest] = note.slice(HUB_NOTE_LEAD.length).split("\n\n");
    expect(line).toBe(
      "The designer's change is blocked: The hub refuses every write to the design.",
    );
    expect(rest.join("\n\n")).toContain(blocked.tried);
    expect(note).toContain("Do not start the same work again");
    // A failure's own advice, to start it again, is not given for a block.
    expect(note).not.toContain("start it again if that fixes it");
  }
  const failed = specialistEndedMessage({
    ...ended,
    status: "failed",
    blocked: null,
  });
  expect(failed).toContain("stopped before finishing");
  expect(failed).toContain("start it again if that fixes it");
});
