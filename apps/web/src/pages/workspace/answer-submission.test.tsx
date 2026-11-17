import { beforeEach, afterEach, describe, expect, test, spyOn } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useAnswer } from "./questions-card.tsx";
import { ProductApiError } from "@corbits-builder/client";
import * as conversation from "../../api/conversation.ts";
import { useQuestions } from "./questions.model.ts";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
beforeEach(() => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
});
afterEach(() => {
  if (originalStorage !== undefined)
    Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

function submission(
  send: (
    answer:
      | { reply: string }
      | { answers: Record<string, string[]> }
      | { output: Record<string, unknown> },
  ) => Promise<boolean>,
) {
  let captured: ReturnType<typeof useAnswer<string>> | undefined;
  function Probe() {
    captured = useAnswer(
      "test:submission",
      (value) => (typeof value === "string" ? value : undefined),
      send,
    );
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (captured === undefined) throw new Error("Submission hook did not render");
  return captured;
}

describe("answer submission", () => {
  test("ignores a second call in flight and permits another after rejection", async () => {
    let calls = 0;
    let reject: ((cause: Error) => void) | undefined;
    const answer = submission(async () => {
      calls += 1;
      if (calls > 1) return false;
      return await new Promise<boolean>((_resolve, fail) => {
        reject = fail;
      });
    });
    const first = answer.send({ reply: "Keep this" });
    expect(await answer.send({ reply: "Duplicate" })).toBe(false);
    expect(calls).toBe(1);
    if (reject === undefined) throw new Error("Send did not start");
    reject(new Error("Connection lost"));
    await expect(first).rejects.toThrow("Connection lost");
    expect(await answer.send({ reply: "Retry" })).toBe(false);
    expect(calls).toBe(2);
  });
});

test("the model classifies real hub responses, logs context once and releases sending", async () => {
  const request = spyOn(conversation, "answerQuestion");
  const warning = spyOn(console, "warn").mockImplementation(() => undefined);
  let answer: ReturnType<typeof useQuestions>["answer"] | undefined;
  let failRefresh = false;
  const sending: boolean[] = [];
  function Probe() {
    answer = useQuestions({
      projectId: "project",
      runId: "run",
      archived: false,
      loaded: [
        {
          signalName: "signal",
          at: 1,
          status: "open",
          asked: { plugin: "designer", action: "pick-colours", input: {} },
        },
      ],
      reload: () => {
        if (failRefresh) throw new Error("Refresh failed");
      },
      onChanged: () => undefined,
      setSending: (value) => sending.push(value),
    }).answer;
    return null;
  }
  try {
    renderToStaticMarkup(<Probe />);
    if (answer === undefined) throw new Error("Questions hook did not render");
    for (const scenario of [
      { status: 400, code: "answer_refused", outcome: "refused" },
      { status: 503, code: "question_answer_unavailable", outcome: "unsent" },
      { status: 503, code: "conversation_unreadable", outcome: "unsent" },
      { status: 503, code: "question_answer_500", outcome: "unknown" },
    ]) {
      warning.mockClear();
      request.mockRejectedValueOnce(
        new ProductApiError(
          Response.json({ code: scenario.code }, { status: scenario.status }),
        ),
      );
      expect(await answer("signal", { reply: "Keep my choice" })).toBe(false);
      expect(sending.slice(-2)).toEqual([true, false]);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]?.[1]).toMatchObject({
        signal: "signal",
        plugin: "designer",
        action: "pick-colours",
        project: "project",
        run: "run",
        outcome: scenario.outcome,
        status: scenario.status,
        code: scenario.code,
      });
    }
    warning.mockClear();
    request.mockResolvedValueOnce(undefined);
    failRefresh = true;
    expect(await answer("signal", { reply: "Accepted" })).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[1]).toMatchObject({ outcome: "accepted" });
    expect(sending.slice(-2)).toEqual([true, false]);
  } finally {
    request.mockRestore();
    warning.mockRestore();
  }
});
