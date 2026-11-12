import { expect } from "bun:test";
import { writerFiles } from "./specialists.ts";
import {
  execute,
  ok,
  question,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const first = "The competitor analysis is filed.";
const revised = "The competitor analysis now has prices.";

scenario({
  name: "s09-stale-approval",
  title:
    "approving a document at a version that was revised after the screen opened is refused",
  // The revision may be filed before or after the screen opens; either way the person was shown
  // version 1 and the hub holds version 2 when they answer.
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
    // The revision starts, then the approve screen opens while its writer works.
    turn(
      user(first),
      execute("c_revise", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Add the price of a walk to every app compared.",
      }),
    ),
    turn(
      results(ok("c_revise", "execute")),
      question("c_approve", "writer", "approve", {
        kinds: ["competitor_analysis"],
      }),
    ),
    turn(
      results(ok("c_approve", "question")),
      say("The competitor analysis is approved."),
    ),
    turn(user(revised), say("The revision with prices is in.")),
  ],
  specialists: {
    "writer-1": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Compare the dog-walking apps",
        kind: "competitor_analysis",
        content: "## In short\nThree apps serve our area.",
        report: first,
      }),
    },
    "writer-2": {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Add the price of a walk",
        kind: "competitor_analysis",
        content:
          "## In short\nThree apps serve our area, from 15 to 25 a walk.",
        report: revised,
      }),
    },
  },
  person: async (p) => {
    const shown = await p.filed("competitor_analysis", 1);
    await p.question();
    await p.filed("competitor_analysis", 2);
    const approve = (version: number) =>
      p.answer({
        output: {
          approved: [
            {
              kind: "competitor_analysis",
              artifactId: shown.artifactId,
              version,
            },
          ],
        },
      });
    const stale = await approve(1);
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).toContain("stale");
    const current = await approve(2);
    expect(current.status).toBe(200);
    await p.heard("The revision with prices is in.");
    const approved = await p.filed("competitor_analysis", 2);
    expect(approved.approvedVersion).toBe(2);
  },
});
