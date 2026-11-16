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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AnnotatedToolFactory } from "@intx/agent/authoring";
import type { ToolEnv } from "@corbits-builder/plugin/tools";
import { noopAuditStore, permissiveAuthorize } from "@intx/agent/testing";
import { createIsogitStore } from "@intx/storage-isogit/node";
import { createRuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { WorkflowHttpError } from "@corbits-builder/plugin/http-json";
import { toolFailure } from "./project-scope.ts";
import { CATALOG, PLUGINS_FOLDER } from "../plugins/catalog.ts";

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

test("the host returns a plugin tool's hub refusal unchanged", async () => {
  const presenter = CATALOG.packages.get("presenter");
  if (presenter === undefined || !("agent" in presenter))
    throw new Error("presenter_agent_missing");
  if (presenter.agent.tools === null)
    throw new Error("presenter_tools_missing");
  const previousAgent = process.env.BUILDER_AGENT;
  const previousTools = process.env.BUILDER_TOOLS;
  const workspace = await mkdtemp(join(tmpdir(), "plugin-refusal-"));
  const issues = [{ path: "grant", message: "Write access is required." }];
  const hint = "The run no longer has access.";
  let calls = 0;
  try {
    process.env.BUILDER_AGENT = JSON.stringify(presenter.agent);
    process.env.BUILDER_TOOLS = resolve(PLUGINS_FOLDER, presenter.agent.tools);
    const { default: loaded } = await import(`${ENTRY}?plugin-refusal`);
    const factory: AnnotatedToolFactory<ToolEnv> | undefined =
      loaded.steps.work.agent.toolFactories.find(
        (factory: AnnotatedToolFactory<ToolEnv>) =>
          factory.definitions.some(({ name }) => name === "file_package"),
      );
    if (factory === undefined) throw new Error("package_tools_missing");
    const runner = factory({
      sources: [],
      defaultSource: "test",
      storage: await createIsogitStore(workspace),
      workdir: workspace,
      toolCwd: workspace,
      audit: noopAuditStore(),
      authorize: permissiveAuthorize(),
      directors: createDefaultDirectorRegistry(),
      capabilities: createRuntimeCapabilities({
        credentials: {
          resolve: async () => ({
            kind: "http",
            dispose: async () => undefined,
            fetch: async () => {
              calls += 1;
              return Response.json(
                { code: "forbidden", issues, hint },
                { status: 403 },
              );
            },
          }),
        },
      }),
    });
    const result = await runner.run(
      { id: "refused", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(result).toEqual(
      toolFailure(
        "refused",
        new WorkflowHttpError(403, "unspecified", "forbidden", issues, hint),
        "tool_call_refused",
      ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(String(result.content))).toEqual({
      code: "forbidden",
      status: 403,
      issues,
      hint,
    });
    expect(result.detail).toEqual({ accessRefused: true });
    expect(calls).toBe(1);
  } finally {
    if (previousAgent === undefined) delete process.env.BUILDER_AGENT;
    else process.env.BUILDER_AGENT = previousAgent;
    if (previousTools === undefined) delete process.env.BUILDER_TOOLS;
    else process.env.BUILDER_TOOLS = previousTools;
    await rm(workspace, { recursive: true, force: true });
  }
});
