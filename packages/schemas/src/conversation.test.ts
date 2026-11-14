import { expect, test } from "bun:test";
import {
  clippedTurnText,
  deliveredText,
  maxTurnText,
  parkedQuestions,
} from "./conversation.ts";

const asked = (signalName: string, question: unknown) => ({
  seq: 0,
  type: "SignalAwaited",
  body: {
    parkKind: "question",
    signalName,
    at: "2026-11-10T10:00:00.000Z",
    question,
  },
});
const answered = (signalName: string, payload: unknown) => ({
  seq: 0,
  type: "SignalReceived",
  body: { signalName, payload },
});
const audience = {
  questions: [
    {
      id: "q-audience",
      header: "Audience",
      question: "Who is it for?",
      options: [{ label: "Small teams", description: "" }],
      multiple: false,
      custom: false,
    },
  ],
};
const smallTeams = { answers: { "q-audience": ["Small teams"] } };

test("a stored question or answer that does not parse is skipped, never thrown or taken as an answer", () => {
  const questions = parkedQuestions([
    asked("question-1", { questions: [] }),
    answered("question-1", smallTeams),
    asked("question-2", audience),
    answered("question-2", { answers: "Small teams" }),
    asked("question-3", audience),
    answered("question-3", smallTeams),
  ]);
  expect(
    questions.map(({ signalName, answer }) => [signalName, answer]),
  ).toEqual([
    ["question-2", undefined],
    ["question-3", smallTeams],
  ]);
});

test("a second answer to a question does not replace the first, which the agent received", () => {
  const [question] = parkedQuestions([
    asked("question-1", audience),
    answered("question-1", smallTeams),
    answered("question-1", { reply: "Everyone" }),
  ]);
  expect(question?.answer).toEqual(smallTeams);
});

test("a 200,000-space run inside a line stays while the line's trailing blanks go", () => {
  const text = `a${" ".repeat(200_000)}b`;
  expect(deliveredText(`${text}\t \r\n`)).toBe(text);
});

test("a turn clipped at its limit never keeps half of an emoji", () => {
  const text = `${"a".repeat(maxTurnText - 1)}😀 more`;
  expect(clippedTurnText(text)).toBe("a".repeat(maxTurnText - 1));
});
