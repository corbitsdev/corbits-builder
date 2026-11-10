import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { wording } from "../../config.ts";
import {
  QuestionsCard,
  enterAnswer,
  keyIntent,
  type QuestionsState,
} from "./questions-card.tsx";

const text = wording.questions;

const ask: AskQuestions = {
  questions: [
    {
      id: "audience",
      prompt: "Who is it for?",
      kind: "single",
      options: [
        { value: "teams", label: "Small teams" },
        { value: "solo", label: "Just me" },
      ],
      preselected: ["teams"],
    },
    {
      id: "first_version",
      prompt: "What must the first version do?",
      kind: "multi",
      options: [{ value: "track", label: "Track tasks" }],
      allowOther: true,
    },
    {
      id: "devices",
      prompt: "Where will people open it?",
      kind: "multi",
      options: [{ value: "desktop", label: "Desktop browser" }],
    },
  ],
};

const open: QuestionsState = {
  kind: "open",
  disabled: false,
  onSend: () => Promise.resolve(true),
};

const reply = [
  text.answerLine("Who is it for?", ["Small teams"]),
  text.answerLine("What must the first version do?", ["Track tasks"]),
].join("\n");

describe("questions card", () => {
  test("the heading counts the questions", () => {
    expect(text.title(1)).toBe("A question for you");
    expect(text.title(2)).toBe("A couple of questions for you");
    expect(text.title(5)).toBe("A few questions for you");
  });

  test("the first question opens as native radios, with the next one waiting below", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="call-1" ask={ask} state={open} />,
    );
    expect(html).toContain(text.position(1, 3));
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(text.pickOne);
    // The recommended answer is picked, so Continue is ready.
    expect(html).toMatch(
      /checked=""\/><span aria-hidden="true"><svg[^]*?<\/span>Small teams/,
    );
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain("What must the first version do?");
    expect(html).toContain(text.more(1));
    expect(html).toContain(`>${text.next}<`);
  });

  test("a single question shows no position and its button sends", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="call-1"
        ask={{ questions: [ask.questions[1]!] }}
        state={open}
      />,
    );
    expect(html).not.toContain(text.position(1, 1));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(`placeholder="${text.other}"`);
    // Nothing is picked yet, so the button says why it waits.
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(`>${text.send}<`);
  });

  test("an answered card is one line, its answers folded", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="call-1"
        ask={ask}
        state={{ kind: "answered", reply }}
      />,
    );
    expect(html).toContain(`aria-label="${text.answered}"`);
    expect(html).toContain(text.answerCount(2));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<dl");
  });

  test("a card answered in the person's own words shows no answers", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="call-1"
        ask={ask}
        state={{ kind: "answered", reply: "Actually, let's build a game." }}
      />,
    );
    expect(html).toContain(text.answeredInChat);
    expect(html).not.toContain(text.show);
  });
});

describe("question keys", () => {
  test("Enter continues anywhere but on a button, which clicks itself", () => {
    expect(keyIntent("Enter", "option")).toEqual({ kind: "next" });
    expect(keyIntent("Enter", "own")).toEqual({ kind: "next" });
    expect(keyIntent("Enter", "button")).toBeUndefined();
  });

  test("← → step through the questions, but move the caret while typing", () => {
    expect(keyIntent("ArrowRight", "option")).toEqual({ kind: "forward" });
    expect(keyIntent("ArrowLeft", "button")).toEqual({ kind: "back" });
    expect(keyIntent("ArrowRight", "own")).toBeUndefined();
    expect(keyIntent("ArrowLeft", "own")).toBeUndefined();
  });

  test("↑↓ move between options; Escape leaves the own-words field", () => {
    expect(keyIntent("ArrowDown", "option")).toEqual({ kind: "move", by: 1 });
    expect(keyIntent("ArrowUp", "own")).toEqual({ kind: "move", by: -1 });
    expect(keyIntent("Escape", "own")).toEqual({ kind: "move", by: -1 });
    expect(keyIntent("Escape", "option")).toBeUndefined();
  });

  test("Space and digits pick, except while typing", () => {
    expect(keyIntent(" ", "option")).toEqual({ kind: "pickFocused" });
    expect(keyIntent(" ", "own")).toBeUndefined();
    expect(keyIntent(" ", "button")).toBeUndefined();
    expect(keyIntent("3", "option")).toEqual({ kind: "pick", index: 2 });
    expect(keyIntent("3", "own")).toBeUndefined();
    expect(keyIntent("0", "option")).toBeUndefined();
  });

  test("Enter on a pick-one question goes on with the focused option, not the recommendation", () => {
    const [single, multi] = ask.questions;
    const recommended = { chosen: ["teams"], own: "" };
    expect(enterAnswer(single!, recommended, 1)).toEqual({
      chosen: ["solo"],
      own: "",
    });
    // Focus on the own-words field or a button keeps the answer as it is.
    expect(enterAnswer(single!, recommended, 2)).toBe(recommended);
    expect(enterAnswer(single!, recommended, -1)).toBe(recommended);
    // On a pick-any question Space ticks; Enter only continues.
    const ticked = { chosen: [], own: "Export" };
    expect(enterAnswer(multi!, ticked, 0)).toBe(ticked);
  });
});
