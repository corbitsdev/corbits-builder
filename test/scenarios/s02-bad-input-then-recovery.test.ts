import { expect } from "bun:test";
import {
  call,
  execute,
  ok,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const report = "The competitor analysis is filed.";
const corrected = {
  kind: "competitor_analysis",
  title: "Competitor analysis",
  instruction: "Compare the dog-walking apps people near us use.",
};

scenario({
  name: "s02-bad-input-then-recovery",
  title:
    "a writer write with a missing field and a wrong kind is refused with what to fix, and the corrected call starts",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_bad", "writer", "write", {
        kind: "Competitor Analysis",
        title: "Competitor analysis",
      }),
    ),
    turn(
      results(refused("c_bad", "execute")),
      execute("c_good", "writer", "write", corrected),
    ),
    turn(results(ok("c_good", "execute")), say("A writer is on it.")),
    turn(user(report), say("Your competitor analysis is ready.")),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: [
        turn(
          user("competitor_analysis"),
          call("w_file", "write_artifact", {
            kind: "competitor_analysis",
            title: "Competitor analysis",
            content: "## In short\nThree apps serve our area.",
          }),
        ),
        turn(results(ok("w_file", "write_artifact")), say(report)),
      ],
    },
  },
  person: async (p) => {
    await p.heard("Your competitor analysis is ready.");
    const refusal = p.resultOf("c_bad");
    p.note("the refusal the coordinator was sent", refusal.text);
    // It names both wrong fields, says what a kind may be, and what to do next.
    expect(refusal.text).toContain("instruction");
    expect(refusal.text).toContain("kind");
    expect(refusal.text).toContain("competitor_analysis");
    expect(refusal.text.toLowerCase()).toMatch(/call|try|again|execute/);
  },
});
