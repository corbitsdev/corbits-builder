import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@intx/agent/authoring";
import { noopAuditStore } from "@intx/agent/testing";
import { createDefaultDirectorRegistry } from "@intx/agent";
import { setupHarness, type Harness } from "@intx/inference-testing";
import { createIsogitStore } from "@intx/storage-isogit/node";
import {
  runLocal,
  type RunResult,
  type WorkflowAuthorizeFn,
  type WorkflowRun,
} from "@intx/workflow";
import { createWorkflowStepInvoker } from "@intx/workflow-host/local";
import { createWriterAgent } from "./agent.ts";
import { writerTaskMessage } from "./contract.ts";
import { createWriterWorkflow } from "./workflow.ts";

const source = {
  id: "openai-compatible:model",
  provider: "openai-compatible",
  baseURL: "https://model.test/v1",
  credentialId: "model-key",
  model: "model",
};
const constraints = {
  kind: "constraints",
  title: "Constraints",
  content: "# Constraints\n\nRuns in the browser.",
};

// Stands in for the hub's write_artifact, which the writer is given at deploy time.
const filed: unknown[] = [];
const writeArtifact = defineTool({
  id: "@corbits-builder/writer-test/artifacts",
  definitions: [{ name: "write_artifact" }],
  factory: () => ({
    definitions: [
      {
        name: "write_artifact",
        description: "Write the next version of one project document.",
        inputSchema: { type: "object" },
      },
    ],
    run: async (call) => {
      filed.push(call.arguments);
      return { callId: call.id, content: "filed" };
    },
  }),
});

const workflow = createWriterWorkflow({
  id: "writer",
  address: "writer",
  agent: createWriterAgent({
    id: "writer",
    inference: { provider: source.provider, model: source.model },
    tools: [writeArtifact],
    capabilities: [],
  }),
  inference: { literal: {} },
});

const allow: WorkflowAuthorizeFn = async () => ({
  effect: "allow",
  matchingGrants: [],
  resolvedBy: null,
});

// The harness serves model calls only while it runs, so it runs until the workflow settles.
async function runUntilSettled(
  harness: Harness,
  run: WorkflowRun,
): Promise<RunResult> {
  let settled = false;
  async function settle() {
    try {
      return await run.complete;
    } finally {
      settled = true;
    }
  }
  const settling = settle();
  while (!settled) {
    await harness.run({ wallClockBudgetMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return settling;
}

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

test("a writer files its one document, then replies", async () => {
  const harness = setupHarness();
  cleanup.push(() => harness.dispose());
  const baseDir = await mkdtemp(join(tmpdir(), "writer-model-turns-"));
  cleanup.push(() => rm(baseDir, { recursive: true, force: true }));
  harness.scenario.replyOnce("openai", {
    toolCalls: [
      { callId: "call-write", name: "write_artifact", args: constraints },
    ],
  });
  harness.scenario.replyOnce("openai", { text: "Filed the constraints." });

  const directors = createDefaultDirectorRegistry();
  const invokeStep = createWorkflowStepInvoker({
    workflowAuthorize: allow,
    buildEnv: async () => ({
      sources: [source],
      defaultSource: source.id,
      storage: await createIsogitStore(join(baseDir, "context")),
      workdir: join(baseDir, "workspace"),
      audit: noopAuditStore(),
      directors,
      readCurrentMaterial: () => ({ secret: "model-key" }),
      deps: harness.deps,
    }),
  });

  const result = await runUntilSettled(
    harness,
    runLocal(workflow, {
      authorize: allow,
      directors,
      invokeStep,
      hasUpstreamSignalResolver: false,
      triggerPayload: writerTaskMessage({
        task: "Write the constraints for a habit tracker.",
        documents: [
          {
            ref: "brief-1",
            kind: "problem_brief",
            title: "Problem brief",
            content: "A habit tracker for one person.",
          },
        ],
        artifact: "constraints",
      }),
    }),
  );

  expect(result.terminalStatus).toBe("completed");
  expect(filed).toEqual([constraints]);
});
