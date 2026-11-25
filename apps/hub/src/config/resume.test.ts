import { expect, test } from "bun:test";
import {
  HANDOFF_OPENING,
  resumeContext,
  resumeMessage,
  withoutResumeContext,
} from "./resume.ts";
import { withPluginHint } from "../plugins/tools.ts";

// The hub mails the handoff note as the person so the replacement coordinator acts on it; shown in
// the conversation, it would read as something the person said.
test("the hub's handoff note never shows as the person's message", () => {
  const context = resumeContext({
    turns: [{ role: "person", text: "Build a weather app", at: 1 }],
    questions: [],
    awaiting: [],
    withApp: false,
  });
  expect(withoutResumeContext(HANDOFF_OPENING)).toBeUndefined();
  expect(
    withoutResumeContext(resumeMessage(context, HANDOFF_OPENING)),
  ).toBeUndefined();
  expect(withoutResumeContext(resumeMessage(context, "Go ahead"))).toBe(
    "Go ahead",
  );
});

test("a resumed message with a plugin hint shows only the person's words", () => {
  const context = resumeContext({
    turns: [{ role: "person", text: "Build a weather app", at: 1 }],
    questions: [],
    awaiting: [],
    withApp: false,
  });
  const delivered = resumeMessage(
    context,
    withPluginHint("fields", "the font is ugly"),
  );
  expect(delivered).toContain("Builder's note");
  expect(withoutResumeContext(delivered)).toBe("the font is ugly");
});

test("a long answer to one earlier question does not cut off the next", () => {
  const context = resumeContext({
    turns: [],
    questions: [
      {
        signalName: "asked",
        at: 1,
        asked: {
          questions: [
            {
              id: "who",
              header: "Audience",
              question: "Who signs up on it?",
              options: [],
              multiple: false,
              custom: true,
            },
            {
              id: "when",
              header: "Shifts",
              question: "When are the shifts?",
              options: [],
              multiple: false,
              custom: true,
            },
          ],
        },
        status: "answered",
        answer: { answers: { who: ["x".repeat(3_000)], when: ["Mornings"] } },
      },
    ],
    awaiting: [],
    withApp: false,
  });
  expect(context).toContain(
    "You asked: When are the shifts? / Person answered: Mornings",
  );
});
