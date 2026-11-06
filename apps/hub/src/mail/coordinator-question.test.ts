import { expect, test } from "bun:test";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { lastOpenAsk } from "./coordinator-question.ts";

const person = "b65b0e2f4c4a444db11b7321dc413964@sunny-harbor-panda.localhost";
const run = "run_04ba732b8686649f77a2797393bafbc5@sunny-harbor-panda.localhost";
const questions: AskQuestions["questions"] = [
  {
    id: "audience",
    prompt: "Who is this for?",
    kind: "single",
    options: [{ value: "me", label: "Just me" }],
  },
];

const inbound = (from: string, text: string, timestamp: number) => ({
  role: "user",
  content: [{ type: "text", text: `[From: ${from}]\n\n${text}` }],
  timestamp,
});
const ask = (id: string, args: unknown, timestamp: number) => ({
  role: "assistant",
  content: [{ type: "tool_call", id, name: "ask_questions", arguments: args }],
  timestamp,
});
const asked = [
  inbound(person, "A habit tracker", 1),
  ask("call_1", { questions }, 2),
];
const open = { callId: "call_1", arguments: { questions } };

test("the person's next turn answers the ask", () => {
  expect(
    lastOpenAsk([...asked, inbound(person, "Just me", 3)], undefined),
  ).toBeUndefined();
});

test("a workflow run's mail leaves the ask open", () => {
  expect(
    lastOpenAsk([...asked, inbound(run, "The brief is filed.", 3)], undefined),
  ).toEqual(open);
});

test("an approval decision's note leaves the ask open", () => {
  const declined = JSON.stringify({ outcome: "rejected", message: "Not yet" });
  expect(
    lastOpenAsk([...asked, inbound("signal@local", declined, 3)], undefined),
  ).toEqual(open);
});
