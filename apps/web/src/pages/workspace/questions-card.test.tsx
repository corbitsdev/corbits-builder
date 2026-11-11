import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskedQuestion } from "@intx/types/runtime-core";
import { wording } from "../../config.ts";
import { QuestionsCard, type QuestionsState } from "./questions-card.tsx";

const text = wording.questions;

const asked: AskedQuestion = {
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
  ],
};

const open: QuestionsState = {
  kind: "open",
  disabled: false,
  onSend: () => Promise.resolve(true),
};

describe("questions card", () => {
  test("the heading counts the questions", () => {
    expect(text.title(1)).toBe("A question for you");
    expect(text.title(2)).toBe("A couple of questions for you");
    expect(text.title(5)).toBe("A few questions for you");
  });

  test("one at a time, the first question shows under its header's tab, the tabs ending in Submit", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="signal-1" asked={asked} state={open} layout="steps" />,
    );
    expect(html).toContain(text.title(2));
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">Audience<");
    expect(html).toContain(">First version<");
    expect(html).toContain(`>${text.submit}<`);
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Small teams");
    expect(html).not.toContain("What must the first version do?");
    expect(html).toContain(text.keys.single);
    expect(html).not.toContain("data-done");
  });

  test("all at once, every question shows and Other is offered only where the person may type", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="signal-1" asked={asked} state={open} layout="all" />,
    );
    expect(html).toContain("Who is it for?");
    expect(html).toContain("What must the first version do?");
    expect(html.split(`>${text.other}<`)).toHaveLength(2);
    expect(html).not.toContain(`placeholder="${text.other}"`);
    expect(html).not.toContain('role="tablist"');
  });

  test("an answered card pairs each question with the answer sent under its id, whichever layout asked it", () => {
    const answered: QuestionsState = {
      kind: "answered",
      answer: {
        answers: { "q-audience": ["Small teams"], "q-first": ["Track tasks"] },
      },
    };
    const settled = (["steps", "all"] as const).map((layout) =>
      renderToStaticMarkup(
        <QuestionsCard
          id="signal-1"
          asked={asked}
          state={answered}
          layout={layout}
        />,
      ),
    );
    expect(settled[0]).toBe(settled[1]!);
    expect(settled[0]).toContain(`aria-label="${text.answered}"`);
    expect(settled[0]).toContain("<dt>Who is it for?</dt><dd>Small teams</dd>");
    expect(settled[0]).toContain(
      "<dt>What must the first version do?</dt><dd>Track tasks</dd>",
    );
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
        layout="steps"
      />,
    );
    expect(html).toContain(text.answeredInWords);
    expect(html).toContain("Actually, let&#x27;s build a game.");
    expect(html).not.toContain("<dl");
  });
});
