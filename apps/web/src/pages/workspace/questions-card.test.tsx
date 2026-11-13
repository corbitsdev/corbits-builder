import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { wording } from "../../config.ts";
import {
  QuestionsCard,
  answerLabels,
  enterAnswer,
  keyIntent,
  type PromptsQuestion,
  type QuestionsState,
} from "./questions-card.tsx";

const text = wording.questions;

const asked: PromptsQuestion = {
  questions: [
    {
      id: "q-audience",
      header: "Audience",
      question: "Who is it for?",
      options: [
        { label: "Small teams", description: "" },
        { label: "Just me", description: "" },
      ],
      multiple: false,
      custom: false,
    },
    {
      id: "q-first",
      header: "First version",
      question: "What must the first version do?",
      options: [{ label: "Track tasks", description: "" }],
      multiple: true,
      custom: true,
    },
    {
      id: "q-name",
      header: "Name",
      question: "What is it called?",
      options: [],
      multiple: false,
      custom: true,
    },
  ],
};

const open: QuestionsState = {
  kind: "open",
  disabled: false,
  onSend: () => Promise.resolve(true),
  onCancel: () => Promise.resolve(true),
};

describe("questions card", () => {
  test("the heading counts the questions", () => {
    expect(text.title(1)).toBe("A question for you");
    expect(text.title(2)).toBe("A couple of questions for you");
    expect(text.title(5)).toBe("A few questions for you");
  });

  test("the first question opens as native radios, with the next one waiting below", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="signal-1" asked={asked} state={open} />,
    );
    expect(html).toContain(text.position(1, 3));
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(text.pickOne);
    // Nothing is picked yet, so Continue waits.
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("What must the first version do?");
    expect(html).toContain(text.more(1));
    expect(html).toContain(`>${text.next}<`);
  });

  test("the recommended answer is preselected", () => {
    const recommended: PromptsQuestion = {
      questions: [
        {
          ...asked.questions[0]!,
          options: [
            { label: "Small teams (Recommended)", description: "" },
            { label: "Just me", description: "" },
          ],
        },
        asked.questions[1]!,
      ],
    };
    const html = renderToStaticMarkup(
      <QuestionsCard id="signal-1" asked={recommended} state={open} />,
    );
    // The recommended answer is picked, so Continue is ready.
    expect(html).toMatch(
      /checked=""\/><span aria-hidden="true"><svg[^]*?<\/span><span>Small teams \(Recommended\)/,
    );
    expect(html).toContain('aria-disabled="false"');
    expect(html).toContain(`>${text.next}<`);
  });

  test("Continue, Back and Cancel share one row of actions, Continue first", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="signal-1" asked={asked} state={open} />,
    );
    const row =
      /<div[^>]*>(?:(?!<\/?div)[^])*>Continue<(?:(?!<\/?div)[^])*>Back<(?:(?!<\/?div)[^])*>Cancel<\/button><\/div>/;
    expect(html).toMatch(row);
    expect(html.split(`>${text.cancel}<`)).toHaveLength(2);
  });

  test("a single question shows no position and its button sends", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="signal-1"
        asked={{ questions: [asked.questions[1]!] }}
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

  test("a question with no options is a field for the person's own words", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="signal-1"
        asked={{ questions: [asked.questions[2]!] }}
        state={open}
      />,
    );
    expect(html).toContain('aria-label="What is it called?"');
    expect(html).not.toContain(`placeholder="${text.other}"`);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(text.pickOne);
    expect(html).toContain(`>${text.send}<`);
  });

  test("an answered card pairs each question with the answer sent under its id, nothing folded", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="signal-1"
        asked={asked}
        state={{
          kind: "answered",
          answer: {
            answers: {
              "q-audience": ["Small teams"],
              "q-first": ["Track tasks"],
              "q-name": ["Bakery orders"],
            },
          },
        }}
      />,
    );
    const line = (question: string, answer: string) =>
      `<span>${question}</span> <span>${answer}</span>`;
    const plain = html.replace(/ class="[^"]*"/g, "");
    expect(plain).toContain(line("Who is it for?", "Small teams"));
    expect(plain).toContain(
      line("What must the first version do?", "Track tasks"),
    );
    expect(plain).toContain(line("What is it called?", "Bakery orders"));
    expect(html).not.toContain("aria-expanded");
  });

  test("a card answered in the person's own words keeps what they wrote", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        id="signal-1"
        asked={asked}
        state={{
          kind: "answered",
          answer: { reply: "Actually, let's build a game." },
        }}
      />,
    );
    expect(html).toContain(text.answeredInWords);
    expect(html).toContain("Actually, let&#x27;s build a game.");
    expect(html).not.toContain("<form");
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

  test("Enter on a pick-one question goes on with the focused option, not the one picked", () => {
    const [single, multi] = asked.questions;
    const picked = { chosen: ["Small teams"], own: "" };
    expect(enterAnswer(single!, picked, 1)).toEqual({
      chosen: ["Just me"],
      own: "",
    });
    // Focus on the own-words field or a button keeps the answer as it is.
    expect(enterAnswer(single!, picked, 2)).toBe(picked);
    expect(enterAnswer(single!, picked, -1)).toBe(picked);
    // On a pick-any question Space ticks; Enter only continues.
    const ticked = { chosen: [], own: "Export" };
    expect(enterAnswer(multi!, ticked, 0)).toBe(ticked);
  });

  test("Enter never swaps typed words for an option focus passes over", () => {
    const [single] = asked.questions;
    // Esc or ↑ from the field, or a failed send, leaves focus on an option.
    const typed = { chosen: ["Small teams"], own: "A bakery" };
    expect(enterAnswer(single!, typed, 0)).toBe(typed);
    expect(enterAnswer(single!, typed, 1)).toBe(typed);
  });

  test("on a pick-one question typed words stand in for the pick until cleared", () => {
    const [single, multi] = asked.questions;
    expect(
      answerLabels(single!, { chosen: ["Small teams"], own: "A bakery" }),
    ).toEqual(["A bakery"]);
    // Typing and deleting a letter keeps the pick.
    expect(
      answerLabels(single!, { chosen: ["Small teams"], own: " " }),
    ).toEqual(["Small teams"]);
    // On a pick-any question the words come after the options ticked.
    expect(
      answerLabels(multi!, { chosen: ["Track tasks"], own: "Export" }),
    ).toEqual(["Track tasks", "Export"]);
  });
});
