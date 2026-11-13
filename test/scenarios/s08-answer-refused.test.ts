import { expect } from "bun:test";
import { writerFiles } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const report = "The competitor analysis is filed.";

scenario({
  name: "s08-answer-refused",
  title:
    "an answer that does not fit the screen is refused with the full text and the question stays open",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_write", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Compare the dog-walking apps people near us use.",
      }),
    ),
    turn(results(ok("c_write", "execute")), say("A writer is on it.")),
    turn(
      user(report),
      execute("c_approve", "writer", "approve", {
        kinds: ["competitor_analysis"],
      }),
    ),
    turn(
      results(ok("c_approve", "execute", '"reply"')),
      say("I will wait until you have read it."),
    ),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "competitor_analysis",
        kind: "competitor_analysis",
        content: "## In short\nThree apps serve our area.",
        report,
      }),
    },
  },
  person: async (p) => {
    const filed = await p.filed("competitor_analysis", 1);
    const asked = await p.question();
    // Approves nothing, and names a field the screen does not have.
    const empty = await p.answer({ output: { approved: [] } });
    const stray = await p.answer({
      output: {
        approved: [
          {
            kind: "competitor_analysis",
            artifactId: filed.artifactId,
            version: 1,
          },
        ],
        signedBy: "me",
      },
    });
    expect(empty.status).toBe(400);
    expect(stray.status).toBe(400);
    expect(JSON.stringify(empty.body)).toContain("approved");
    expect(JSON.stringify(stray.body)).toContain("signedBy");
    const still = await p.question();
    expect(still.signalName).toBe(asked.signalName);
    const reply = await p.answer({ reply: "Let me read it first." });
    expect(reply.status).toBe(200);
    await p.heard("I will wait until you have read it.");
    const unapproved = await p.filed("competitor_analysis", 1);
    expect(unapproved.approvedVersion).toBeUndefined();
  },
});
