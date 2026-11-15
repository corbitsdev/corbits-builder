import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskedQuestion } from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import {
  QuestionsCard,
  answerLabels,
  enterAnswer,
  keyIntent,
} from "./questions-card.tsx";

const text = wording.questions;

const ask: AskedQuestion = {
  questions: [
    {
      id: "audience",
      header: "Audience",
      question: "Who is it for?",
      options: [
        { label: "Small teams (Recommended)", description: "" },
        { label: "Just me", description: "" },
      ],
      multiple: false,
      custom: false,
    },
    {
      id: "first_version",
      header: "First version",
      question: "What must the first version do?",
      options: [{ label: "Track tasks", description: "" }],
      multiple: true,
      custom: true,
    },
    {
      id: "devices",
      header: "Devices",
      question: "Where will people open it?",
      options: [{ label: "Desktop browser", description: "" }],
      multiple: true,
      custom: false,
    },
  ],
};

const send = () => Promise.resolve(true);

const answers = {
  audience: ["Small teams (Recommended)"],
  first_version: ["Track tasks"],
  devices: ["Desktop browser"],
};

describe("questions card", () => {
  test("the heading counts the questions", () => {
    expect(text.title(1)).toBe("A question for you");
    expect(text.title(2)).toBe("A couple of questions for you");
    expect(text.title(5)).toBe("A few questions for you");
  });

  test("the first question opens as native radios, with the next one waiting below", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{ at: 0, signalName: "call-1", asked: ask, status: "open" }}
        disabled={false}
        onSend={send}
      />,
    );
    expect(html).toContain(text.position(1, 3));
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(text.pickOne);
    // The recommended answer is picked, so Continue is ready.
    expect(html).toMatch(
      /checked=""\/><span[^>]*aria-hidden="true"><svg[^]*?<\/span><span[^>]*>Small teams \(Recommended\)/,
    );
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain("What must the first version do?");
    expect(html).toContain(text.more(1));
    expect(html).toContain(`>${text.next}<`);
  });

  test("a single question shows no position and its button sends", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{
          at: 0,
          signalName: "call-1",
          asked: { questions: [ask.questions[1]!] },
          status: "open",
        }}
        disabled={false}
        onSend={send}
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
        question={{
          at: 0,
          signalName: "call-1",
          asked: ask,
          status: "answered",
          answer: { answers },
        }}
        disabled={false}
        onSend={send}
      />,
    );
    expect(html).toContain(`aria-label="${text.answered}"`);
    expect(html).toContain(text.answerCount(3));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<dl");
  });

  test("a card answered in the person's own words shows what they wrote, not answers", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{
          at: 0,
          signalName: "call-1",
          asked: ask,
          status: "answered",
          answer: { reply: "Actually, let's build a game." },
        }}
        disabled={false}
        onSend={send}
      />,
    );
    expect(html).toContain(text.answeredInChat);
    expect(html).toContain("Actually, let&#x27;s build a game.");
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
    const recommended = { chosen: ["Small teams (Recommended)"], own: "" };
    expect(enterAnswer(single!, recommended, 1)).toEqual({
      chosen: ["Just me"],
      own: "",
    });
    // Focus on the own-words field or a button keeps the answer as it is.
    expect(enterAnswer(single!, recommended, 2)).toBe(recommended);
    expect(enterAnswer(single!, recommended, -1)).toBe(recommended);
    // On a pick-any question Space ticks; Enter only continues.
    const ticked = { chosen: [], own: "Export" };
    expect(enterAnswer(multi!, ticked, 0)).toBe(ticked);
  });

  test("Enter never swaps typed words for an option focus passes over", () => {
    const [single] = ask.questions;
    // Esc or ↑ from the field, or a failed send, leaves focus on an option.
    const typed = { chosen: ["Small teams (Recommended)"], own: "A bakery" };
    expect(enterAnswer(single!, typed, 0)).toBe(typed);
    expect(enterAnswer(single!, typed, 1)).toBe(typed);
  });

  test("on a pick-one question typed words stand in for the pick until cleared", () => {
    const [single, multi] = ask.questions;
    expect(
      answerLabels(single!, {
        chosen: ["Small teams (Recommended)"],
        own: "A bakery",
      }),
    ).toEqual(["A bakery"]);
    // Typing and deleting a letter keeps the recommended answer.
    expect(
      answerLabels(single!, {
        chosen: ["Small teams (Recommended)"],
        own: " ",
      }),
    ).toEqual(["Small teams (Recommended)"]);
    // On a pick-any question the words come after the options ticked.
    expect(
      answerLabels(multi!, { chosen: ["Track tasks"], own: "Export" }),
    ).toEqual(["Track tasks", "Export"]);
  });
});
