import { QuestionOutcomes } from "./question-outcome.tsx";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import { wording } from "../../config.ts";
import {
  QuestionsCard,
  answerLabels,
  enterAnswer,
  keyIntent,
  withWords,
} from "./questions-card.tsx";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
});
afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

const text = wording.questions;

const ask: PromptQuestion["asked"] = {
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
  test("a fresh card restores saved picks, typed words and the open question for its signal", () => {
    stored.set(
      "unsent:questions:call-1",
      JSON.stringify({
        step: 1,
        answers: [
          { chosen: ["Just me"], own: "" },
          { chosen: ["Track tasks"], own: "Export reports" },
          { chosen: [], own: "" },
        ],
      }),
    );
    const render = (signalName: string) =>
      renderToStaticMarkup(
        <QuestionsCard
          question={{
            at: 0,
            signalName,
            asked: ask,
            status: "open",
          }}
          disabled={false}
          onAnswer={send}
        />,
      );
    for (let mount = 0; mount < 2; mount++) {
      const html = render("call-1");
      expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
      expect(html).toContain('value="Export reports"');
      expect(html).toContain('aria-disabled="false"');
      expect(html).toContain(wording.questions.position(2, 3));
    }
    const other = render("call-2");
    expect(other).not.toContain('value="Export reports"');
    expect(other).toContain(wording.questions.position(1, 3));
  });

  test("invalid saved JSON or answer shapes start with the recommended answer", () => {
    for (const saved of [
      "{",
      JSON.stringify({
        step: 0,
        answers: ask.questions.map(() => ({ chosen: 3, own: "words" })),
      }),
      JSON.stringify({
        step: 7,
        answers: ask.questions.map(() => ({ chosen: [], own: "" })),
      }),
      "[]",
      "null",
    ]) {
      stored.set("unsent:questions:call-1", saved);
      const html = renderToStaticMarkup(
        <QuestionsCard
          question={{ at: 0, signalName: "call-1", asked: ask, status: "open" }}
          disabled={false}
          onAnswer={send}
        />,
      );
      expect(html).toContain('checked=""');
      expect(html).toContain('aria-disabled="false"');
    }
  });

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
        onAnswer={send}
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

  test("in the prompt box nothing starts picked, the recommendation is a tag and the box takes own words", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{ at: 0, signalName: "call-1", asked: ask, status: "open" }}
        disabled={false}
        onAnswer={send}
        place="box"
      />,
    );
    expect(html).toContain(">Who is it for?</h3>");
    expect(html).toContain(text.position(1, 3));
    // No Back on the first question, and nothing picked, so no Continue either.
    expect(html).not.toContain(`aria-label="${text.back}"`);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain(`>${text.next}<`);
    expect(html).toContain(`Small teams<span`);
    expect(html).toContain(`>${text.recommended}<`);
    expect(html).not.toContain(`placeholder="${text.other}"`);
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
        onAnswer={send}
      />,
    );
    expect(html).not.toContain(text.position(1, 1));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(`placeholder="${text.other}"`);
    // Nothing is picked yet, so the button says why it waits.
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(`>${text.send}<`);
  });

  test("a question with no options asks for typed words, not a pick", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{
          at: 0,
          signalName: "call-1",
          asked: {
            questions: [
              {
                id: "name",
                header: "Name",
                question: "What should the app be called?",
                options: [],
                multiple: false,
                custom: true,
              },
            ],
          },
          status: "open",
        }}
        disabled={false}
        onAnswer={send}
      />,
    );
    expect(html).toContain(`placeholder="${text.typed}"`);
    expect(html).not.toContain(text.pickOne);
    expect(html).not.toContain("aria-describedby");
  });

  test("an answered card lists each question with its answer", () => {
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
        onAnswer={send}
      />,
    );
    expect(html).toContain(`aria-label="${text.answered}"`);
    expect(html).toContain("<dt>Who is it for?</dt><dd>Small teams</dd>");
  });

  test("a closed card lists each question as not answered and takes no answer", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard
        question={{ at: 0, signalName: "call-1", asked: ask, status: "closed" }}
        disabled={false}
        onAnswer={send}
      />,
    );
    expect(html).toContain(text.closed(3));
    expect(html).toMatch(
      new RegExp(`<dt>Who is it for\\?</dt><dd[^>]*>${text.notAnswered}</dd>`),
    );
    expect(html).not.toContain("<input");
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
        onAnswer={send}
      />,
    );
    expect(html).toContain(text.answeredInChat);
    expect(html).toContain("Actually, let&#x27;s build a game.");
    expect(html).not.toContain("<dl");
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

test("a refusal sent outside the card is shown by the card from the shared question outcome", () => {
  const html = renderToStaticMarkup(
    <QuestionOutcomes
      value={
        new Map([
          ["typed-reply", { kind: "refused", fault: text.answerFault.refused }],
        ])
      }
    >
      <QuestionsCard
        question={{
          signalName: "typed-reply",
          at: 1,
          asked: ask,
          status: "open",
        }}
        disabled={false}
        onAnswer={send}
      />
    </QuestionOutcomes>,
  );
  expect(html).toContain(text.answerFault.refused);
});

describe("words sent from the prompt box", () => {
  const [audience, firstVersion, devices] = ask.questions;

  test("after a pick they are details that go with it, not in place of it", () => {
    const answer = withWords(
      audience!,
      { chosen: ["Just me"], own: "" },
      "Mostly at weekends",
    );
    expect(answer).toEqual({
      chosen: ["Just me"],
      own: "",
      details: "Mostly at weekends",
    });
    expect(answerLabels(audience!, answer!)).toEqual([
      "Just me",
      "Mostly at weekends",
    ]);
  });

  test("with nothing picked they are the person's own answer where the question takes one", () => {
    expect(
      withWords(firstVersion!, { chosen: [], own: "" }, "Share lists"),
    ).toEqual({ chosen: [], own: "Share lists" });
    // A question with options and no own answer leaves the words to the conversation.
    expect(
      withWords(devices!, { chosen: [], own: "" }, "On a tablet"),
    ).toBeUndefined();
  });
});
