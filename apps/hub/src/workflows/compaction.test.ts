import { expect, test } from "bun:test";
import { createCapabilities } from "@intx/inference";
import type {
  InferenceError,
  ReactorAction,
  ReactorDirector,
  ReactorInboundEvent,
  ReactorState,
  RetryPolicy,
} from "@intx/types/runtime";
import { REPETITION_ABORT } from "../inference/repetition.ts";
import { compactingDirector } from "./compaction.ts";

const director = (replyOnFailure: boolean) =>
  compactingDirector("@corbits-builder/test").factory(
    { contextWindow: 200_000, compactAt: 0.8, replyOnFailure },
    {} as never,
    { systemPrompt: "", toolDefinitions: [], compactorNames: [] },
  ) as ReactorDirector;

const state: ReactorState = {
  turns: [],
  activeForks: [],
  pendingOperations: [],
  activeGates: [],
  tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
  lastCycleUsage: null,
  lastCycleSource: null,
  sessionId: "session",
};

const decide = async (subject: ReactorDirector, event: ReactorInboundEvent) => {
  const actions = await subject.decide(event, state, createCapabilities());
  return (Array.isArray(actions) ? actions : [actions]) as ReactorAction[];
};

const failed = (error: InferenceError): ReactorInboundEvent => ({
  type: "inference.error",
  error,
  partial: { text: "" },
});

const retryPolicy = (actions: ReactorAction[]): RetryPolicy => {
  const infer = actions.find((action) => action.type === "infer");
  const policy =
    infer?.type === "infer" ? infer.options?.retryPolicy : undefined;
  if (!policy) throw new Error("infer_without_retry_policy");
  return policy;
};

const overloaded: InferenceError = {
  category: "retryable",
  message: "overloaded",
  statusCode: 529,
};

test("every inference retries a busy model on a bounded backoff", async () => {
  const subject = director(false);
  const policies = [
    retryPolicy(
      await decide(subject, {
        type: "reactor.gate.cleared",
        gateId: "gate",
        reason: "resolved",
      }),
    ),
    retryPolicy(
      await decide(
        subject,
        failed({
          category: "protocol_mismatch",
          message: `${REPETITION_ABORT} repeated`,
        }),
      ),
    ),
  ];
  const timeout: InferenceError = { category: "timeout", message: "stall" };
  const quota = (retryAfterMs: number): InferenceError => ({
    category: "quota_exhausted",
    message: "rate limited",
    retryAfterMs,
  });
  for (const policy of policies) {
    const decision = (error: InferenceError, attempt: number, elapsedMs = 0) =>
      policy({ error, attempt, elapsedMs });
    expect(
      await Promise.all([
        decision(overloaded, 1),
        decision(overloaded, 2),
        decision(overloaded, 3),
        decision(overloaded, 4),
        decision(overloaded, 2, 6 * 60_000),
        decision(timeout, 1),
        decision(timeout, 2),
        decision(quota(45_000), 1),
        decision(quota(90_000), 1),
        decision({ category: "fatal", message: "bad request" }, 1),
      ]),
    ).toEqual([
      { kind: "retry", delayMs: 2_000 },
      { kind: "retry", delayMs: 8_000 },
      { kind: "retry", delayMs: 30_000 },
      { kind: "abort" },
      { kind: "abort" },
      { kind: "retry", delayMs: 2_000 },
      { kind: "abort" },
      { kind: "retry", delayMs: 45_000 },
      { kind: "abort" },
      { kind: "abort" },
    ]);
  }
});

test("a model error that outlasts the retries fails a specialist and is the coordinator's reply", async () => {
  await expect(decide(director(false), failed(overloaded))).rejects.toThrow(
    "model_unavailable",
  );
  const reply = (await decide(director(true), failed(overloaded))).find(
    (action) => action.type === "reply",
  );
  expect(reply?.type === "reply" ? reply.content : "").toContain("overloaded");
});
