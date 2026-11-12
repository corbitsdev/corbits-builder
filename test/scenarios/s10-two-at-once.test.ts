import { expect } from "bun:test";
import { WEATHER_MOCKUP } from "./concept.ts";
import { writerFiles } from "./specialists.ts";
import {
  calls,
  execute,
  ok,
  recorded,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const writerReport = "The competitor analysis is filed.";

scenario({
  name: "s10-two-at-once",
  title:
    "a writer and a designer started in one coordinator turn both report back",
  start: "weather-documents",
  expectChange:
    "execute is becoming one uniform result and a runs tool is coming; the two execute results and the order of the reports may read differently.",
  coordinator: [
    turn(
      user("competitor analysis and show me a mockup"),
      calls(
        execute("c_write", "writer", "write", {
          kind: "competitor_analysis",
          title: "Competitor analysis",
          instruction: "Compare the weather apps people use today.",
        }),
        execute("c_design", "designer", "mockup", WEATHER_MOCKUP),
      ),
    ),
    turn(
      results(ok("c_write", "execute"), ok("c_design", "execute")),
      say("A writer and a designer are on it."),
    ),
    // Either report may come first; the trace shows which did.
    turn(user(), say("First report read.")),
    turn(user(), say("Second report read.")),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "competitor_analysis",
        kind: "competitor_analysis",
        content:
          "## In short\nFour weather apps lead; none animates the scene.",
        report: writerReport,
      }),
    },
    designer: { role: "designer", turns: await recorded("designer-1") },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Write a competitor analysis and show me a mockup.");
    await p.heard("Second report read.");
    const write = p.resultOf("c_write");
    const design = p.resultOf("c_design");
    p.note("writer write returned", write.text);
    p.note("designer mockup returned", design.text);
    const reports = await p.hub.client.conversationEvents(
      p.tenantId,
      p.projectId,
    );
    p.note("what the person saw", reports.turns?.slice(-6));
    await p.filed("competitor_analysis", 1);
    await p.filed("design_option");
    const said = JSON.stringify(reports.turns);
    expect(said).toContain("Second report read.");
    const received = [p.assignment("writer"), p.assignment("designer")];
    expect(received.every((text) => text.length > 0)).toBe(true);
  },
});
