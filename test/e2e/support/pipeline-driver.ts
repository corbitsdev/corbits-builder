import { expect } from "bun:test";
import { join } from "node:path";
import { type } from "arktype";
import type { NativeApproval, ProjectArtifact } from "@corbits-builder/client";
import {
  startTestHub,
  type TestHubHandle,
  type TestHubOptions,
} from "./hub.ts";
import {
  startRecordedModelServer,
  type RecordedModelServer,
} from "./recorded-model.ts";

export const FIXTURE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "fixtures",
  "pipeline",
);
export const STAGE_DEADLINE_MS = 180_000;

const RequestApprovalArgs = type({
  kinds: "string[]",
});

export const NonEmptyString = type("string > 0");

type ArtifactMilestone = Readonly<{
  kind: string;
  version: number;
}>;

type ArtifactApprovalStep = Readonly<{
  stage: string;
  kind: string;
  version: number;
  afterApproved?: ArtifactMilestone;
  decision: "approve" | "reject";
  feedback?: string;
}>;

type ToolApprovalStep = Readonly<{
  stage: string;
  toolName: string;
  afterApproved?: ArtifactMilestone;
  afterFiled?: ArtifactMilestone;
  decision?: "approve" | "reject";
  feedback?: string;
}>;

function createEventSignal(recordedModel: RecordedModelServer): {
  notify: () => void;
  waitForNext: (stage: string, signal: AbortSignal) => Promise<void>;
  dispose: () => void;
} {
  const waiters = new Set<() => void>();
  function notify(): void {
    for (const wake of waiters) {
      wake();
    }
    waiters.clear();
  }
  const unsubscribeModel = recordedModel.onActivity(notify);
  return {
    notify,
    waitForNext: (stage: string, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const failure = recordedModel.firstFailure();
        if (failure) {
          reject(failure);
          return;
        }
        if (signal.aborted) {
          reject(
            new Error(
              `Timed out waiting for event in stage "${stage}": ${String(signal.reason)}`,
            ),
          );
          return;
        }
        const onWake = (): void => {
          signal.removeEventListener("abort", onAbort);
          waiters.delete(onWake);
          const modelErr = recordedModel.firstFailure();
          if (modelErr) {
            reject(modelErr);
            return;
          }
          resolve();
        };
        const onAbort = (): void => {
          waiters.delete(onWake);
          const modelErr = recordedModel.firstFailure();
          if (modelErr) {
            reject(modelErr);
            return;
          }
          reject(
            new Error(
              `Stage "${stage}" exceeded deadline (${STAGE_DEADLINE_MS}ms)`,
            ),
          );
        };
        waiters.add(onWake);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    dispose: () => {
      unsubscribeModel();
      waiters.clear();
    },
  };
}

export function isQuestionPark(event: {
  type: string;
  body: Record<string, unknown>;
}): boolean {
  return (
    event.type === "SignalAwaited" && event.body["parkKind"] === "question"
  );
}

export function openQuestionPark<
  Event extends { type: string; body: Record<string, unknown> },
>(events: readonly Event[]): Event | undefined {
  return events.find(
    (event) =>
      isQuestionPark(event) &&
      !events.some(
        (later) =>
          later.type === "SignalReceived" &&
          later.body["signalName"] === event.body["signalName"],
      ),
  );
}

function findPendingToolApproval(
  approvals: readonly NativeApproval[],
  toolName: string,
  expectedArtifactKind?: string,
): NativeApproval | undefined {
  return approvals.find((approval) => {
    if (approval.status !== "pending") return false;
    if (approval.toolDefinition["name"] !== toolName) return false;
    if (!expectedArtifactKind) return true;
    const parsed = RequestApprovalArgs(approval.toolArguments);
    if (parsed instanceof type.errors) return false;
    return parsed.kinds.includes(expectedArtifactKind);
  });
}

export function findArtifact(
  artifacts: readonly ProjectArtifact[],
  kind: string,
  version?: number,
): ProjectArtifact | undefined {
  return artifacts.find(
    (item) =>
      item.kind === kind && (version === undefined || item.version === version),
  );
}

function hasMilestone(
  artifacts: readonly ProjectArtifact[],
  milestone: ArtifactMilestone | undefined,
  mode: "filed" | "approved",
): boolean {
  if (!milestone) return true;
  const found = findArtifact(artifacts, milestone.kind, milestone.version);
  if (!found) return false;
  return mode === "approved"
    ? found.approvedVersion === milestone.version
    : true;
}

export async function withPipelineScenario(
  options: {
    fixtureDir: string;
    projectId: string;
    title: string;
    problemStatement: string;
    hub?: TestHubOptions;
  },
  run: (driver: {
    hub: TestHubHandle;
    projectTenantId: string;
    projectId: string;
    coordinatorRunId: string;
    runStage: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    waitForAssistantTurn: (stage: string, substring: string) => Promise<void>;
    waitForArtifactAndTurn: (
      stage: string,
      milestone: ArtifactMilestone,
      substring: string,
    ) => Promise<void>;
    sendMessage: (lines: readonly string[]) => Promise<void>;
    decideArtifactApproval: (step: ArtifactApprovalStep) => Promise<void>;
    decideToolApproval: (step: ToolApprovalStep) => Promise<void>;
    chooseFiledDesignOption: (
      stage: string,
      version: number,
      presentationSubstring: string,
    ) => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const totalStart = performance.now();
  const stageTimingsMs: Record<string, number> = {};
  const recordedModel = await startRecordedModelServer(options.fixtureDir);
  let hub: TestHubHandle | undefined;
  const events = createEventSignal(recordedModel);

  try {
    hub = await startTestHub(recordedModel, options.hub);
    const { client, workspaceTenantId } = hub;

    const createStart = performance.now();
    const createReceipt = await client.mutateProject(
      workspaceTenantId,
      options.projectId,
      {
        mutationId: `mut-create-${options.projectId}`,
        idempotencyKey: `idem-create-${options.projectId}`,
        command: "create_project",
        payload: {
          title: options.title,
          profile: "recorded_replay",
          problemStatement: options.problemStatement,
        },
      },
    );
    expect(createReceipt.ok).toBe(true);
    expect(createReceipt.projectId).toBe(options.projectId);

    const projectView = await client.project(
      workspaceTenantId,
      options.projectId,
    );
    const projectTenantId = projectView.tenantId;
    const coordinatorRunId = NonEmptyString.assert(
      projectView.coordinatorRunId,
    );
    stageTimingsMs["create"] = Math.round(performance.now() - createStart);

    const unsubscribeStream = hub.subscribeRunStream(
      projectTenantId,
      coordinatorRunId,
      () => {
        events.notify();
      },
    );

    async function waitFor<T>(
      stage: string,
      description: string,
      check: () => Promise<T | undefined>,
    ): Promise<T> {
      const signal = AbortSignal.timeout(STAGE_DEADLINE_MS);
      while (true) {
        const modelErr = recordedModel.firstFailure();
        if (modelErr) throw modelErr;
        const found = await check();
        if (found !== undefined) return found;
        try {
          await events.waitForNext(`${stage} (${description})`, signal);
        } catch (error) {
          const latestErr = recordedModel.firstFailure();
          if (latestErr) throw latestErr;
          throw error;
        }
      }
    }

    try {
      await run({
        hub,
        projectTenantId,
        projectId: options.projectId,
        coordinatorRunId,
        runStage: async (name, fn) => {
          const start = performance.now();
          const result = await fn();
          stageTimingsMs[name] =
            (stageTimingsMs[name] ? stageTimingsMs[name] : 0) +
            Math.round(performance.now() - start);
          return result;
        },
        waitForAssistantTurn: async (stage, substring) => {
          await waitFor(
            stage,
            `assistant turn containing ${JSON.stringify(substring)}`,
            async () => {
              const conv = await client.conversationEvents(
                projectTenantId,
                options.projectId,
              );
              return conv.turns?.find(
                (turn) =>
                  turn.role === "assistant" && turn.text.includes(substring),
              );
            },
          );
        },
        waitForArtifactAndTurn: async (stage, milestone, substring) => {
          await waitFor(
            stage,
            `${milestone.kind} v${milestone.version} filed and assistant turn ${JSON.stringify(substring)}`,
            async () => {
              const [{ artifacts }, conv] = await Promise.all([
                client.projectArtifacts(projectTenantId, options.projectId),
                client.conversationEvents(projectTenantId, options.projectId),
              ]);
              if (!findArtifact(artifacts, milestone.kind, milestone.version)) {
                return undefined;
              }
              return conv.turns?.find(
                (turn) =>
                  turn.role === "assistant" && turn.text.includes(substring),
              );
            },
          );
        },
        sendMessage: async (lines) => {
          await client.sendMessage(projectTenantId, coordinatorRunId, {
            content: lines.join("\n"),
          });
        },
        decideArtifactApproval: async (step) => {
          const approval = await waitFor(
            step.stage,
            `${step.kind} v${step.version} approval request`,
            async () => {
              const [{ artifacts }, { data: approvals }] = await Promise.all([
                client.projectArtifacts(projectTenantId, options.projectId),
                client.nativeApprovals(projectTenantId),
              ]);
              if (!hasMilestone(artifacts, step.afterApproved, "approved")) {
                return undefined;
              }
              if (!findArtifact(artifacts, step.kind, step.version)) {
                return undefined;
              }
              return findPendingToolApproval(
                approvals,
                "request_approval",
                step.kind,
              );
            },
          );
          await client.decideNativeApproval(
            projectTenantId,
            approval.id,
            step.decision,
            "once",
            step.feedback,
          );
        },
        decideToolApproval: async (step) => {
          const approval = await waitFor(
            step.stage,
            `${step.toolName} approval request`,
            async () => {
              const [{ artifacts }, { data: approvals }] = await Promise.all([
                client.projectArtifacts(projectTenantId, options.projectId),
                client.nativeApprovals(projectTenantId),
              ]);
              if (!hasMilestone(artifacts, step.afterApproved, "approved")) {
                return undefined;
              }
              if (!hasMilestone(artifacts, step.afterFiled, "filed")) {
                return undefined;
              }
              return findPendingToolApproval(approvals, step.toolName);
            },
          );
          await client.decideNativeApproval(
            projectTenantId,
            approval.id,
            step.decision ? step.decision : "approve",
            "once",
            step.feedback,
          );
        },
        chooseFiledDesignOption: async (
          stage,
          version,
          presentationSubstring,
        ) => {
          const designOption = await waitFor(
            stage,
            `design_option v${version} and coordinator presentation`,
            async () => {
              const [{ artifacts }, conv] = await Promise.all([
                client.projectArtifacts(projectTenantId, options.projectId),
                client.conversationEvents(projectTenantId, options.projectId),
              ]);
              const option = findArtifact(artifacts, "design_option", version);
              if (!option) return undefined;
              const presented = conv.turns?.some(
                (turn) =>
                  turn.role === "assistant" &&
                  turn.text.includes(presentationSubstring),
              );
              return presented ? option : undefined;
            },
          );
          const designReceipt = await client.chooseDesign(
            projectTenantId,
            options.projectId,
            {
              artifactId: designOption.artifactId,
              version: designOption.version,
            },
          );
          expect(designReceipt.design.kind).toBe("design");
          expect(designReceipt.design.version).toBe(version);
        },
      });

      stageTimingsMs["total"] = Math.round(performance.now() - totalStart);
      recordedModel.assertClean();
      console.log(
        JSON.stringify({
          scenario: recordedModel.scenario,
          stageTimingsMs,
        }),
      );
    } finally {
      unsubscribeStream();
    }
  } finally {
    events.dispose();
    if (hub) await hub.close();
    await recordedModel.stop();
  }
}

export type PipelineDriver = Parameters<
  Parameters<typeof withPipelineScenario>[1]
>[0];

// The recorded weather project from the idea to its approved product requirements.
async function writeWeatherDocuments(driver: PipelineDriver): Promise<void> {
  await driver.runStage("documents", async () => {
    await driver.waitForAssistantTurn(
      "documents",
      "weather app is a great one",
    );
    await driver.sendMessage([
      "1. It's for people who want a weather app where the whole interface animates to match the live weather (rain, snow, sun, storm, wind, fog, day/night).",
      "2. Current conditions, 24-hour forecast, 7-day forecast, multi-city search & saved locations, side-by-side city comparison, and custom weather scene animations.",
      "3. Free public weather API (Open-Meteo, no API key required), responsive web app, smooth 60fps canvas/CSS animations.",
    ]);

    const documentSteps: readonly ArtifactApprovalStep[] = [
      {
        stage: "documents",
        kind: "problem_brief",
        version: 1,
        decision: "approve",
      },
      {
        stage: "documents",
        kind: "constraints",
        version: 1,
        afterApproved: { kind: "problem_brief", version: 1 },
        decision: "approve",
      },
      {
        stage: "documents",
        kind: "approaches",
        version: 1,
        afterApproved: { kind: "constraints", version: 1 },
        decision: "reject",
        feedback: "I think Approach B is the best",
      },
      {
        stage: "documents",
        kind: "approaches",
        version: 2,
        decision: "approve",
      },
      {
        stage: "documents",
        kind: "product_requirements",
        version: 1,
        afterApproved: { kind: "approaches", version: 2 },
        decision: "approve",
      },
    ];

    for (const step of documentSteps) {
      await driver.decideArtifactApproval(step);
    }
  });
}

// The recorded weather project from the idea to its app's second version, after one change.
export async function buildWeatherApp(driver: PipelineDriver): Promise<void> {
  await writeWeatherDocuments(driver);
  await driver.runStage("design", async () => {
    await driver.decideToolApproval({
      stage: "design",
      toolName: "design_app",
      afterApproved: { kind: "product_requirements", version: 1 },
    });
    await driver.chooseFiledDesignOption("design", 1, "The design is filed");
  });

  await driver.runStage("build", async () => {
    await driver.decideArtifactApproval({
      stage: "build",
      kind: "build_plan",
      version: 1,
      afterApproved: { kind: "design", version: 1 },
      decision: "approve",
    });
    await driver.decideToolApproval({
      stage: "build",
      toolName: "instruct_coder",
      afterApproved: { kind: "build_plan", version: 1 },
      afterFiled: { kind: "app", version: 1 },
    });
    await driver.waitForArtifactAndTurn(
      "build",
      { kind: "app", version: 2 },
      "filed as version 2",
    );
  });
}
