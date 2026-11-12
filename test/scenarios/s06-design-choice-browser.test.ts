import { expect } from "bun:test";
import { WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
import {
  execute,
  ok,
  question,
  recorded,
  results,
  say,
  scenario,
  turn,
  user,
  type Turn,
} from "./runner.ts";

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
const concepts = [WEATHER_CONCEPT, paper, night];
const COMMENT = "The serif headings are lovely; keep them in mind.";
const designer = await recorded("designer-1");

// The recorded designer, given one concept of its own.
function designerFor(label: string): Turn[] {
  const [first, ...rest] = designer;
  if (first === undefined) throw new Error("The recorded designer is empty");
  return [turn(user(label), first.reply, first.requiredTools), ...rest];
}

scenario({
  name: "s06-design-choice-browser",
  title:
    "in the web app the person compares three concepts, comments on one and chooses another",
  start: "weather-documents",
  coordinator: [
    turn(
      user("three different looks"),
      execute("c_mockup", "designer", "mockup", {
        instruction: WEATHER_MOCKUP.instruction,
        lookIdeas: WEATHER_MOCKUP.lookIdeas,
        concepts,
      }),
    ),
    turn(results(ok("c_mockup", "execute")), say("Three designers are on it.")),
    turn(user(), say("One concept is in.")),
    turn(user(), say("Two concepts are in.")),
    turn(
      user(),
      question("c_choose", "designer", "choose", {
        note: "Three looks to compare. Pick the one you want.",
      }),
    ),
    turn(
      results(ok("c_choose", "question", COMMENT)),
      say("You chose a design."),
    ),
    turn(user("The person chose"), say("The design is chosen.")),
  ],
  specialists: {
    "designer-1": {
      role: "designer",
      turns: designerFor(WEATHER_CONCEPT.label),
    },
    "designer-2": { role: "designer", turns: designerFor(paper.label) },
    "designer-3": { role: "designer", turns: designerFor(night.label) },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Show me three different looks to compare.");
    await p.question();
    await p.browser(async (page, shoot) => {
      const choice = page.locator('[data-slot="design-choice"]');
      await choice.waitFor({ timeout: 180_000 });
      await shoot("01-three-concepts");
      await choice.getByLabel(`Comment: ${paper.label}`).fill(COMMENT);
      await choice.getByRole("radio", { name: night.label }).check();
      await shoot("02-commented-and-picked");
      await choice.getByRole("button", { name: "Choose this design" }).click();
      await page
        .getByText("The design is chosen.")
        .first()
        .waitFor({ timeout: 180_000 });
      await shoot("03-chosen");
    });
    const answer = p.resultOf("c_choose");
    p.note("the coordinator received", answer.text);
    expect(answer.text).toContain(night.label);
    expect(answer.text).toContain(COMMENT);
    const design = await p.filed("design");
    expect(design.approvedVersion).toBe(design.version);
  },
});
