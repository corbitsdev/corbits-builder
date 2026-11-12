import { expect } from "bun:test";
import {
  call,
  execute,
  ok,
  question,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const ask = "Write me a competitor analysis of the dog-walking apps near us.";
const report = "The competitor analysis is filed.";

scenario({
  name: "s01-any-document",
  title: "the writer writes a document of any kind and the person approves it",
  start: { fresh: ask },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_write", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction:
          "Compare the dog-walking apps people near us use: what each offers, its price and where it falls short.",
      }),
    ),
    turn(results(ok("c_write", "execute")), say("A writer is on it.")),
    turn(
      user(report),
      question("c_approve", "writer", "approve", {
        kinds: ["competitor_analysis"],
      }),
    ),
    turn(
      results(ok("c_approve", "question", '"approved"')),
      say("The competitor analysis is approved."),
    ),
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
            content:
              "## In short\nThree apps serve our area; none offers same-day group walks.",
          }),
        ),
        turn(results(ok("w_file", "write_artifact")), say(report)),
      ],
    },
  },
  person: async (p) => {
    const filed = await p.filed("competitor_analysis", 1);
    await p.question();
    const answered = await p.answer({
      output: {
        approved: [
          {
            kind: "competitor_analysis",
            artifactId: filed.artifactId,
            version: 1,
          },
        ],
      },
    });
    expect(answered.status).toBe(200);
    await p.heard("The competitor analysis is approved.");
    const approved = await p.filed("competitor_analysis", 1);
    expect(approved.approvedVersion).toBe(1);
  },
});
