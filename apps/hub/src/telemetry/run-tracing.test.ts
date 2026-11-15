import { expect, test } from "bun:test";
import { createRunTracing, type RunContext } from "./run-tracing.ts";
import type { FinishedSpan, RunSpanAgent } from "./run-spans.ts";

type Listener = (frame: { agentAddress: string; event: unknown }) => void;

function tracing(describeRun: (runId: string) => Promise<RunContext>) {
  const listeners: Listener[] = [];
  const accepted: { agent: RunSpanAgent; event: unknown }[] = [];
  const run = createRunTracing({
    events: {
      on: (_name, listener) => {
        listeners.push(listener);
        return () => {};
      },
    },
    runSpans: {
      accept: (agent: RunSpanAgent, event: unknown): FinishedSpan[] => {
        accepted.push({ agent, event });
        return [];
      },
      shutdown: (): FinishedSpan[] => [],
    },
    runExport: {
      send: () => {},
      flush: async () => {},
      shutdown: async () => {},
    },
    describeRun,
  });
  const emit = (event: unknown) =>
    listeners.forEach((listener) =>
      listener({ agentAddress: "run_a-step@hub.localhost", event }),
    );
  return { run, emit, accepted };
}

test("events of one run are traced in arrival order and its project is asked for once", async () => {
  let asked = 0;
  const { run, emit, accepted } = tracing(async () => {
    asked += 1;
    await Bun.sleep(asked === 1 ? 20 : 0);
    return { tenantId: "tenant_a", projectId: "project_a" };
  });
  emit("first");
  emit("second");
  emit("third");
  await run.dispose();
  expect(accepted.map((entry) => entry.event)).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(accepted.every((entry) => entry.agent.projectId === "project_a")).toBe(
    true,
  );
  expect(asked).toBe(1);
});

test("a run without a project yet is asked about again, and a failed lookup loses only its own event", async () => {
  const answers: (RunContext | Error)[] = [
    {},
    new Error("database unavailable"),
    { tenantId: "tenant_a", projectId: "project_a" },
  ];
  const { run, emit, accepted } = tracing(async () => {
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error("asked too often");
    return answer;
  });
  emit("first");
  emit("second");
  emit("third");
  emit("fourth");
  await run.dispose();
  expect(accepted.map((entry) => entry.event)).toEqual([
    "first",
    "third",
    "fourth",
  ]);
  expect(accepted.map((entry) => entry.agent.projectId)).toEqual([
    undefined,
    "project_a",
    "project_a",
  ]);
});
