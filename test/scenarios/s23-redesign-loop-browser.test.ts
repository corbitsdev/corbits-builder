import { expect } from "bun:test";
import { type } from "arktype";
import { DESIGNER_REPORT, WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
import { designerFor, redesigner } from "./specialists.ts";
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

const WAIT_MS = 180_000;
const COMMENT = "Make the add city link a button.";
const LINE = "Keep everything else as it is.";
const TAGGED = "cities-add-link";
const redesign = `Change the ${WEATHER_CONCEPT.label} design as the person asked on its mockup. Their comment on the add city link of the cities screen: "${COMMENT}" They also wrote: "${LINE}"`;
const redesignReport =
  "The add city link is a button now; the design is filed again as this concept's option.";

// What a review answer holds, as far as this scenario reads it.
const ReviewAnswer = type({
  output: {
    decision: "string",
    "version?": "number | string",
    "comments?": type({
      text: "string",
      at: "Record<string, unknown>",
    }).array(),
    "message?": "string",
  },
});

scenario({
  name: "s23-redesign-loop-browser",
  title:
    "in the web app the person tags a place on the mockup and comments, a designer acts on it, and the person approves the next version",
  start: "weather-documents",
  coordinator: [
    turn(
      user("mockup"),
      execute("c_design", "designer", "mockup", WEATHER_MOCKUP),
    ),
    turn(
      results(ok("c_design", "execute")),
      say("A designer is drafting the weather look."),
    ),
    turn(
      user(DESIGNER_REPORT),
      question("c_review_1", "designer", "review", {
        note: "The first weather design. Try it, tag what should change, or approve it.",
      }),
    ),
    turn(
      results(ok("c_review_1", "question", `"testid":"${TAGGED}"`)),
      execute("c_redesign", "designer", "mockup", {
        instruction: redesign,
        lookIdeas: WEATHER_MOCKUP.lookIdeas,
        concepts: [WEATHER_CONCEPT],
      }),
    ),
    turn(
      results(ok("c_redesign", "execute")),
      say("The designer is making the add city link a button."),
    ),
    turn(
      user(redesignReport),
      question("c_review_2", "designer", "review", {
        note: "The add city link is a button now.",
      }),
    ),
    turn(
      results(ok("c_review_2", "question", '"decision":"approved"')),
      say("The design is approved."),
    ),
    turn(
      user(`The person chose the ${WEATHER_CONCEPT.label}`),
      say("The build plan comes next, from the approved design."),
    ),
  ],
  specialists: {
    "designer-1": {
      role: "designer",
      turns: designerFor(WEATHER_CONCEPT.label),
    },
    "designer-2": {
      role: "designer",
      turns: redesigner({
        assignedWith: COMMENT,
        testid: TAGGED,
        report: redesignReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Show me a mockup of the weather app.");
    await p.question();
    await p.browser(async (page, shoot) => {
      const review = page.locator('[data-slot="mockup-review"]');
      const roomPage = page.locator('[data-slot="room-page"]');
      const mockup = page.frameLocator(
        '[data-slot="room-page"] iframe[data-slot="gui-frame"]',
      );
      await review.waitFor({ timeout: WAIT_MS });
      await mockup
        .locator('[data-screen="home"]')
        .first()
        .waitFor({ state: "attached", timeout: WAIT_MS });
      await shoot("01-review-open");
      await page
        .getByRole("combobox", { name: "Screen" })
        .selectOption({ label: "cities / populated" });
      const tagged = mockup.locator(`[data-testid="${TAGGED}"]`);
      await tagged.waitFor({ state: "visible", timeout: WAIT_MS });
      await review.getByRole("button", { name: "Tag" }).click();
      await tagged.click();
      const form = review.locator('[data-slot="comment-form"]');
      await form.waitFor();
      await form.locator("textarea").fill(COMMENT);
      await form.getByRole("button", { name: "Add" }).click();
      await review
        .locator('[data-slot="comments"]')
        .getByText(COMMENT)
        .waitFor();
      await shoot("02-tagged-and-commented");
      const composer = roomPage.locator('[data-slot="composer"] textarea');
      await composer.fill(LINE);
      await composer.press("Enter");
      await roomPage.waitFor({ state: "detached", timeout: WAIT_MS });
      await shoot("03-sent-back-in-conversation");
      await review
        .locator('[data-slot="last-round"]')
        .getByText(COMMENT)
        .waitFor({ timeout: WAIT_MS * 2 });
      await shoot("04-second-review-shows-last-round");
      const approve = review.locator(
        'button:not([disabled]):text-is("Approve")',
      );
      await approve.waitFor({ timeout: WAIT_MS });
      await approve.click();
      await roomPage.waitFor({ state: "detached", timeout: WAIT_MS });
      await page
        .getByText("The design is approved.")
        .first()
        .waitFor({ timeout: WAIT_MS });
      await shoot("05-approved");
    });
    await p.heard("The build plan comes next");
    const changes = ReviewAnswer.assert(
      JSON.parse(p.resultOf("c_review_1").text),
    ).output;
    const approved = ReviewAnswer.assert(
      JSON.parse(p.resultOf("c_review_2").text),
    ).output;
    p.note("the first review's answer", changes);
    p.note("the redesign started", p.resultOf("c_redesign").text);
    p.note("the redesigner's assignment", p.assignment("designer-2"));
    p.note("the second review's answer", approved);
    expect(changes.decision).toBe("changes");
    expect(changes.message).toBe(LINE);
    expect(changes.comments?.map((comment) => comment.text)).toEqual([COMMENT]);
    expect(changes.comments?.[0]?.at).toMatchObject({
      screen: "cities",
      testid: TAGGED,
    });
    expect(approved.decision).toBe("approved");
    const option = await p.filed("design_option", 2);
    const design = await p.filed("design");
    expect(design.approvedVersion).toBe(design.version);
    p.note("the option and design at the end", { option, design });
  },
});
