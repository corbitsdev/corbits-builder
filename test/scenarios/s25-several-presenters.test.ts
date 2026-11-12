import { expect } from "bun:test";
import { DESIGNER_REPORT, WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
import { designerFor } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const paper = {
  label: "Calm paper",
  direction:
    "Quiet off-white paper, one serif for headings, thin rules and no animation behind the text.",
};
const night = {
  label: "Bold night",
  direction:
    "Deep navy throughout, large bright numerals, neon accents that follow the weather.",
};
const mono = {
  label: "Plain mono",
  direction:
    "Black on white, one monospaced face, no colour but a single red for alerts.",
};
// How many lines of a report to keep: the presenters' block and the line before it.
const CLOSING = 4;

scenario({
  name: "s25-several-presenters",
  title:
    "each designer report names designer choose and designer review with when to use each, after three concepts and after one",
  start: "weather-documents",
  coordinator: [
    turn(
      user("three different looks"),
      execute("c_three", "designer", "mockup", {
        instruction: WEATHER_MOCKUP.instruction,
        lookIdeas: WEATHER_MOCKUP.lookIdeas,
        concepts: [WEATHER_CONCEPT, paper, night],
      }),
    ),
    turn(results(ok("c_three", "execute")), say("Three designers are on it.")),
    turn(user(DESIGNER_REPORT), say("One concept is in.")),
    turn(user(DESIGNER_REPORT), say("Two concepts are in.")),
    turn(
      user(DESIGNER_REPORT),
      execute("c_one", "designer", "mockup", {
        instruction: WEATHER_MOCKUP.instruction,
        lookIdeas: WEATHER_MOCKUP.lookIdeas,
        concepts: [mono],
      }),
    ),
    turn(results(ok("c_one", "execute")), say("One more designer is on it.")),
    turn(user(DESIGNER_REPORT), say("The fourth concept is in.")),
  ],
  specialists: {
    "designer-1": {
      role: "designer",
      turns: designerFor(WEATHER_CONCEPT.label),
    },
    "designer-2": { role: "designer", turns: designerFor(paper.label) },
    "designer-3": { role: "designer", turns: designerFor(night.label) },
    "designer-4": { role: "designer", turns: designerFor(mono.label) },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Show me three different looks to compare.");
    await p.heard("The fourth concept is in.");
    p.note("execute for three concepts", p.resultOf("c_three").text);
    p.note("execute for one concept", p.resultOf("c_one").text);
    const reports = p
      .messages("coordinator")
      .filter((message) => message.includes(DESIGNER_REPORT));
    reports.forEach((report, index) =>
      p.note(
        `the closing lines of designer report ${String(index + 1)}`,
        report.split(/\r?\n/).slice(-CLOSING).join("\n"),
      ),
    );
    expect(reports).toHaveLength(4);
    for (const report of reports) {
      expect(report).toContain('action: "choose"');
      expect(report).toContain('action: "review"');
    }
  },
});
