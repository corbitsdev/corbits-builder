import { expect, test } from "bun:test";
import { type } from "arktype";
import { QuestionArguments } from "@intx/types/runtime-core";

// The question tool refuses a malformed call before any card is shown; the card relies on what
// these limits rule out.
const option = (label: string) => ({ label, description: "" });
const twoOptions = [option("The owner"), option("Counter staff")];
const ask = (
  question = "Who takes the orders?",
  header = "Audience",
  options = twoOptions,
) => ({ question, header, options });

test("a question call is refused unless it keeps to the card's limits", () => {
  expect(QuestionArguments({ questions: [ask()] })).not.toBeInstanceOf(
    type.errors,
  );
  const refused = {
    "no questions": { questions: [] },
    "six questions": { questions: Array.from({ length: 6 }, () => ask()) },
    "nine options": {
      questions: [
        ask(
          undefined,
          undefined,
          Array.from({ length: 9 }, (_, i) => option(`Choice ${i}`)),
        ),
      ],
    },
    "an over-long question": { questions: [ask("x".repeat(501))] },
    "an over-long header": { questions: [ask(undefined, "x".repeat(101))] },
    "an over-long option label": {
      questions: [ask(undefined, undefined, [option("x".repeat(201))])],
    },
    "a repeated option label": {
      questions: [ask(undefined, undefined, [option("Same"), option("Same")])],
    },
    "an unknown key on a question": {
      questions: [
        {
          question: "Who takes the orders?",
          header: "Audience",
          options: twoOptions,
          kind: "single",
        },
      ],
    },
    "an unknown key on the call": { questions: [ask()], title: "Orders" },
    "no options and no typed answer": {
      questions: [
        {
          question: "Who takes the orders?",
          header: "Audience",
          options: [],
          custom: false,
        },
      ],
    },
  };
  for (const [name, call] of Object.entries(refused))
    expect([name, QuestionArguments(call) instanceof type.errors]).toEqual([
      name,
      true,
    ]);
});
