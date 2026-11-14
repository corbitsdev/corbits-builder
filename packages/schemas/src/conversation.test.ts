import { expect, test } from "bun:test";
import {
  clippedTurnText,
  deliveredText,
  maxTurnText,
  coordinatorQuestions,
} from "./conversation.ts";

const asked = (signalName: string, question: unknown, stepId = "ask") => ({
  seq: 0,
  type: "SignalAwaited",
  body: {
    parkKind: "question",
    signalName,
    stepId,
    at: "2026-11-10T10:00:00.000Z",
    question,
  },
});
const answered = (signalName: string, payload: unknown) => ({
  seq: 0,
  type: "SignalReceived",
  body: { signalName, payload },
});
const stepEvent = (type: string, stepId: string) => ({
  seq: 0,
  type,
  body: { stepId },
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
const statuses = (
  events: Parameters<typeof coordinatorQuestions>[0],
  live = true,
) => coordinatorQuestions(events, live).map(({ status }) => status);

test("a stored question that does not parse is skipped, and an answer that does not parse closes its question", () => {
  const questions = coordinatorQuestions(
    [
      asked("question-1", { questions: [] }),
      answered("question-1", smallTeams),
      asked("question-2", audience),
      answered("question-2", { answers: "Small teams" }),
    ],
    true,
  );
  expect(questions).toEqual([
    {
      at: Date.parse("2026-11-10T10:00:00.000Z"),
      signalName: "question-2",
      asked: audience,
      status: "closed",
    },
  ]);
});

test("a second answer to a question does not replace the first, which the agent received", () => {
  const [question] = coordinatorQuestions(
    [
      asked("question-1", audience),
      answered("question-1", smallTeams),
      answered("question-1", { reply: "Everyone" }),
    ],
    true,
  );
  expect(question).toMatchObject({ status: "answered", answer: smallTeams });
});

test("an unanswered question is open until the run ends, then closed", () => {
  const events = [
    asked("question-1", audience),
    answered("question-1", smallTeams),
    asked("question-2", audience),
  ];
  expect(statuses(events)).toEqual(["answered", "open"]);
  for (const end of ["RunFailed", "RunCancelled", "RunCompleted"])
    expect(statuses([...events, { seq: 0, type: end, body: {} }])).toEqual([
      "answered",
      "closed",
    ]);
});

test("an earlier run's question is never open", () => {
  expect(
    statuses(
      [
        asked("question-1", audience),
        answered("question-1", smallTeams),
        asked("question-2", audience),
      ],
      false,
    ),
  ).toEqual(["answered", "closed"]);
});

test("another step's later event does not close an open question", () => {
  expect(
    statuses([
      asked("question-1", audience, "ask"),
      stepEvent("StepCompleted", "build"),
    ]),
  ).toEqual(["open"]);
});

test("a deadline the asking step arms does not close its question", () => {
  expect(
    statuses([
      asked("question-1", audience, "ask"),
      stepEvent("TimerSet", "ask"),
    ]),
  ).toEqual(["open"]);
});

test("the asking step's later event closes its question", () => {
  expect(
    statuses([
      asked("question-1", audience, "ask"),
      stepEvent("StepFailed", "ask"),
    ]),
  ).toEqual(["closed"]);
});

test("a 200,000-space run inside a line stays while the line's trailing blanks go", () => {
  const text = `a${" ".repeat(200_000)}b`;
  expect(deliveredText(`${text}\t \r\n`)).toBe(text);
});

test("a turn clipped at its limit never keeps half of an emoji", () => {
  const text = `${"a".repeat(maxTurnText - 1)}😀 more`;
  expect(clippedTurnText(text)).toBe("a".repeat(maxTurnText - 1));
});
