import { expect } from "bun:test";
import { ok, question, results, say, scenario, turn, user } from "./runner.ts";

const SENTENCE = "Honestly I just want it to feel friendlier, not a new font.";
const FONTS = ["look.font-primary", "look.font-secondary"];

scenario({
  name: "s07-typed-reply-browser",
  title:
    "in the web app the person types a sentence while the font picker is open",
  start: "weather-app",
  values: FONTS,
  coordinator: [
    turn(
      user("the font is ugly"),
      question("c_fonts", "designer", "pick-fonts", {
        proposed: { primary: "Arial" },
      }),
    ),
    turn(
      results(ok("c_fonts", "question", SENTENCE)),
      say("Friendlier it is; tell me what feels unfriendly now."),
    ),
  ],
  person: async (p) => {
    await p.heard("The project is imported.");
    const before = await p.call(
      "GET",
      `${p.path}/values?keys=${FONTS.join(",")}`,
    );
    await p.say("the font is ugly");
    await p.question();
    await p.browser(async (page, shoot) => {
      await page.getByText("Choose your fonts").waitFor({ timeout: 180_000 });
      await shoot("01-font-picker-open");
      const composer = page.locator('[data-slot="composer"] textarea').first();
      await composer.fill(SENTENCE);
      await shoot("02-sentence-typed");
      await composer.press("Enter");
      await page
        .getByText("Friendlier it is")
        .first()
        .waitFor({ timeout: 180_000 });
      await shoot("03-coordinator-answered");
    });
    const received = p.resultOf("c_fonts");
    p.note("the coordinator received", received.text);
    expect(JSON.parse(received.text)).toEqual({ reply: SENTENCE });
    const after = await p.call(
      "GET",
      `${p.path}/values?keys=${FONTS.join(",")}`,
    );
    expect(after.body).toEqual(before.body);
  },
});
