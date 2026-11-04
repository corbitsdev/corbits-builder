import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { wording } from "../../config.ts";
import {
  QuestionsCard,
  stepName,
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
  ],
};

const open: QuestionsState = {
  kind: "open",
  disabled: false,
  onSend: () => Promise.resolve(true),
};

describe("questions card", () => {
  test("a step is named from its question id", () => {
    expect(stepName("audience")).toBe("Audience");
    expect(stepName("first_version")).toBe("First version");
    expect(stepName("who-signs in")).toBe("Who signs in");
  });

  test("the heading counts the questions", () => {
    expect(text.title(1)).toBe("A question for you");
    expect(text.title(2)).toBe("A couple of questions for you");
    expect(text.title(5)).toBe("A few questions for you");
  });

  test("one at a time, the first question shows under step tabs ending in Submit", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="call-1" ask={ask} state={open} layout="steps" />,
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
    expect(html).not.toContain("questions-card-step-mark");
  });

  test("all at once, every question shows and Other is an option until chosen", () => {
    const html = renderToStaticMarkup(
      <QuestionsCard id="call-1" ask={ask} state={open} layout="all" />,
    );
    expect(html).toContain("Who is it for?");
    expect(html).toContain("What must the first version do?");
    expect(html).toContain(`>${text.other}<`);
    expect(html).not.toContain(`placeholder="${text.other}"`);
    expect(html).not.toContain('role="tablist"');
  });

  test("an answered card settles whichever layout asked it", () => {
    const reply = [
      text.answerLine("Who is it for?", ["Small teams"]),
      text.answerLine("What must the first version do?", ["Track tasks"]),
    ].join("\n");
    for (const layout of ["steps", "all"] as const) {
      const html = renderToStaticMarkup(
        <QuestionsCard
          id="call-1"
          ask={ask}
          state={{ kind: "answered", reply }}
          layout={layout}
        />,
      );
      expect(html).toContain(text.answered(["Small teams", "Track tasks"]));
    }
  });
});
