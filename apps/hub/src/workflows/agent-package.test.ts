import { expect, jest, test } from "bun:test";
import { createDefaultDirectorRegistry } from "@intx/agent";
import {
  createInMemoryBlobSubstrate,
  createInMemoryRepoStore,
  createInMemoryScheduler,
  createNoopDrainController,
  runtimeRun,
  type StepInvoker,
  type WorkflowRuntimeEnv,
} from "@intx/workflow";
import { createObservedSignalChannel } from "@intx/workflow/testing";
import { CATALOG } from "../plugins/catalog.ts";

// The package a plugin's declared writer is built as, on a model that never answers.
const writer = CATALOG.packages.get("writer-document");
if (writer === undefined || !("agent" in writer))
  throw new Error("the writer declares no agent writer-document");
process.env.BUILDER_AGENT = JSON.stringify(writer.agent);
process.env.BUILDER_ROLE_INFERENCE = JSON.stringify({
  source: { provider: "provider", model: "model" },
  contextWindow: 200_000,
  timeouts: {},
  parameters: { maxTokens: 32_768 },
});
const ENTRY = "./agent-package.ts";
const workflow = (await import(`${ENTRY}?writer-document`)).default;

// A model that never answers: the step ends only when the runtime aborts it, and rejects with the
// abort reason as the real step invoker does.
const stalled: StepInvoker = (request) =>
  new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => {
      reject(request.signal.reason);
    });
  });

test("a stalled write fails once on its timeout and fails the run", async () => {
  const runId = "run-writer";
  const repoStore = createInMemoryRepoStore();
  const clock = () => new Date();
  const env: WorkflowRuntimeEnv = {
    repoStore,
    scheduler: createInMemoryScheduler({ repoStore, clock }),
    signalChannel: createObservedSignalChannel(),
    blobs: createInMemoryBlobSubstrate(),
    directors: createDefaultDirectorRegistry(),
    authorize: async () => ({
      effect: "allow",
      matchingGrants: [],
      resolvedBy: null,
    }),
    invokeStep: stalled,
    spawnChild: () => Promise.reject(new Error("no_children")),
    clock,
    newId: (prefix) => `${prefix}-${crypto.randomUUID()}`,
    drain: createNoopDrainController(workflow),
    hasUpstreamSignalResolver: true,
  };
  jest.useFakeTimers();
  let settled = false;
  try {
    const { complete } = runtimeRun(workflow, env, {
      runId,
      triggerPayload: { body: "Write the constraints." },
    });
    async function settle() {
      try {
        await complete;
      } finally {
        settled = true;
      }
    }
    const settling = settle();
    // Let the run reach its stalled step between clock moves, until the step timeout has passed.
    for (let minute = 0; minute < 120 && !settled; minute += 1) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      jest.advanceTimersByTime(60_000);
    }
    expect(settled).toBe(true);
    await settling;
  } finally {
    jest.useRealTimers();
  }

  const events = await repoStore.read(runId);
  const failed = events.filter((event) => event.kind === "StepFailed");
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({
    stepId: "work",
    attempt: 1,
    retriesExhausted: true,
    error: {
      code: "step-timeout",
      message: expect.stringContaining("step work"),
    },
  });
  expect(events.at(-1)?.kind).toBe("RunFailed");
});
