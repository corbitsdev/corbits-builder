import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import type { NativeApproval, ProjectArtifact } from "@corbits-builder/client";
import { startTestHub, type TestHubHandle } from "./support/hub.ts";
import {
  formatOpenAISseResponse,
  startRecordedModelServer,
  writeScenarioFixture,
  type ExchangeExpectation,
  type RecordedModelServer,
} from "./support/recorded-model.ts";

const FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "pipeline");
const STAGE_DEADLINE_MS = 180_000;

const RequestApprovalArgs = type({
  kinds: "string[]",
});

const NonEmptyString = type("string > 0");

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

type ExpectedArtifactState = Readonly<{
  kind: string;
  version: number;
  approvedVersion?: number;
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

function findArtifact(
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

async function withPipelineScenario(
  options: {
    fixtureDir: string;
    projectId: string;
    title: string;
    problemStatement: string;
  },
  run: (driver: {
    hub: TestHubHandle;
    projectTenantId: string;
    projectId: string;
    coordinatorRunId: string;
    runStage: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    waitFor: <T>(
      stage: string,
      description: string,
      check: () => Promise<T | undefined>,
    ) => Promise<T>;
    waitForAssistantTurn: (stage: string, substring: string) => Promise<void>;
    waitForArtifactAndTurn: (
      stage: string,
      milestone: ArtifactMilestone,
      substring: string,
    ) => Promise<void>;
    sendMessage: (lines: readonly string[]) => Promise<void>;
    decideArtifactApproval: (step: ArtifactApprovalStep) => Promise<void>;
    decideToolApproval: (step: ToolApprovalStep) => Promise<void>;
    assertArtifactStates: (
      expected: readonly ExpectedArtifactState[],
    ) => Promise<readonly ProjectArtifact[]>;
    assertSecretRedacted: (
      artifacts: readonly ProjectArtifact[],
      secret: string,
      minDecidedApprovals?: number,
    ) => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const totalStart = performance.now();
  const stageTimingsMs: Record<string, number> = {};
  const recordedModel = await startRecordedModelServer(options.fixtureDir);
  let hub: TestHubHandle | undefined;
  const events = createEventSignal(recordedModel);

  try {
    hub = await startTestHub(recordedModel);
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
        waitFor,
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
        assertArtifactStates: async (expected) => {
          const { artifacts, failed } = await client.projectArtifacts(
            projectTenantId,
            options.projectId,
          );
          expect(failed).toEqual([]);
          for (const item of expected) {
            const found = findArtifact(artifacts, item.kind);
            expect(found?.version).toBe(item.version);
            if (item.approvedVersion !== undefined) {
              expect(found?.approvedVersion).toBe(item.approvedVersion);
            }
          }
          return artifacts;
        },
        assertSecretRedacted: async (
          artifacts,
          secret,
          minDecidedApprovals,
        ) => {
          for (const item of artifacts) {
            const full = await client.artifact(
              projectTenantId,
              options.projectId,
              item.artifactId,
            );
            expect(JSON.stringify(full)).not.toContain(secret);
          }
          const [finalConv, finalActivity, decided] = await Promise.all([
            client.conversationEvents(projectTenantId, options.projectId),
            client.projectActivity(projectTenantId, options.projectId),
            client.decidedApprovals(projectTenantId, options.projectId),
          ]);
          expect(JSON.stringify(finalConv)).not.toContain(secret);
          expect(JSON.stringify(finalActivity)).not.toContain(secret);
          const expectedMin =
            minDecidedApprovals !== undefined ? minDecidedApprovals : 6;
          expect(decided.approvals.length).toBeGreaterThanOrEqual(expectedMin);
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

function withRequiredTools(
  requiredTools: readonly string[],
  exchanges: readonly {
    sse: string;
    expect: Omit<ExchangeExpectation, "requiredTools">;
  }[],
) {
  return exchanges.map((exchange) => ({
    sse: exchange.sse,
    expect: { ...exchange.expect, requiredTools: [...requiredTools] },
  }));
}

describe("Builder E2E pipeline replay", () => {
  test(
    "drives Animated Weather App from idea through documents, review, design and build to a shipped app",
    async () => {
      await withPipelineScenario(
        {
          fixtureDir: FIXTURE_DIR,
          projectId: "animated-weather-app",
          title: "Animated Weather App",
          problemStatement: "C: Weather App",
        },
        async (driver) => {
          const { hub, projectTenantId, projectId } = driver;
          const { client, workspaceTenantId, fakeCredentialSecret } = hub;

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

          await driver.runStage("design", async () => {
            await driver.decideToolApproval({
              stage: "design",
              toolName: "design_app",
              afterApproved: { kind: "product_requirements", version: 1 },
            });
            await driver.decideToolApproval({
              stage: "design",
              toolName: "choose_design",
              afterFiled: { kind: "design_option", version: 1 },
            });
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

            const appVersions = await client.appVersions(
              projectTenantId,
              projectId,
            );
            expect(appVersions.versions.map((v) => v.version)).toEqual([2, 1]);
            expect(appVersions.versions[0]?.source).toBe("check");
            expect(appVersions.versions[1]?.source).toBe("check");

            const downloaded = await client.downloadApp(
              projectTenantId,
              projectId,
            );
            expect(downloaded.filename.toLowerCase()).toContain(
              "animated-weather-app",
            );
            expect(downloaded.archive.size).toBeGreaterThan(10_000);

            const shipReceipt = await client.shipProject(
              projectTenantId,
              projectId,
              true,
            );
            expect(shipReceipt.ok).toBe(true);
            const shippedAt = NonEmptyString.assert(shipReceipt.shippedAt);

            const { projects } = await client.projects(workspaceTenantId);
            const summary = projects.find((p) => p.projectId === projectId);
            expect(summary?.stage).toBe("shipped");
            expect(summary?.shippedAt).toBe(shippedAt);

            const finalArtifacts = await driver.assertArtifactStates([
              { kind: "problem_brief", version: 1, approvedVersion: 1 },
              { kind: "constraints", version: 1, approvedVersion: 1 },
              { kind: "approaches", version: 2, approvedVersion: 2 },
              { kind: "product_requirements", version: 1, approvedVersion: 1 },
              { kind: "design", version: 1, approvedVersion: 1 },
              { kind: "build_plan", version: 1, approvedVersion: 1 },
              { kind: "app", version: 2 },
            ]);
            await driver.assertSecretRedacted(
              finalArtifacts,
              fakeCredentialSecret,
            );
          });
        },
      );
    },
    STAGE_DEADLINE_MS * 3,
  );

  test(
    "drives presenter approval package, reviewer decisions and owner feedback triage to the coordinator",
    async () => {
      const fixtureDir = await mkdtemp(
        join(tmpdir(), "builder-e2e-approval-fixture-"),
      );
      const coordinatorTools = [
        "read_artifact",
        "write_artifact",
        "request_approval",
        "deploy_writer",
        "deploy_presenter",
      ];
      const presenterTools = [
        "read_skill",
        "write_deck",
        "check_deck",
        "file_package",
      ];
      const deck = {
        theme: {
          colors: {
            primary: "#111827",
            secondary: "#111827",
            accent: "#111827",
            background: "#FFFFFF",
            text: "#111827",
            muted: "#111827",
          },
          fonts: { heading: "Inter", body: "Inter" },
        },
        slides: [{ layout: "title" as const, title: "Ask" }],
      };

      try {
        await writeScenarioFixture(
          fixtureDir,
          {
            scenario: "weather-executive-approval-package",
            recordedFromCommit: "bbfb75d",
          },
          [
            {
              runKey: "coordinator-1",
              role: "coordinator",
              stage: "presentation",
              sourceRunId: "run_coord_approval_1",
              exchanges: withRequiredTools(coordinatorTools, [
                {
                  sse: formatOpenAISseResponse({
                    text: "Tell me who this weather pitch is for.",
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "Weather Executive Pitch",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_write_brief",
                        name: "write_artifact",
                        arguments: {
                          kind: "problem_brief",
                          title: "Brief",
                          content: "Brief",
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "Open-Meteo",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "Brief filed.",
                    toolCalls: [
                      {
                        id: "coord_approve_brief",
                        name: "request_approval",
                        arguments: { kinds: ["problem_brief"] },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_write_brief",
                        toolName: "write_artifact",
                        isError: false,
                        keys: ["artifactId", "kind", "version", "sha256"],
                        bind: {
                          "brief.artifactId": "artifactId",
                          "brief.sha256": "sha256",
                        },
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_deploy_presenter",
                        name: "deploy_presenter",
                        arguments: {
                          audience: "ceo",
                          decisionNeeded: "Approve scope",
                          kinds: ["problem_brief"],
                          tone: "plain",
                          length: "1",
                          instruction:
                            "File a one-slide deck for this audience now.",
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_approve_brief",
                        toolName: "request_approval",
                        isError: false,
                        keys: ["approved"],
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "Presenter started.",
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_deploy_presenter",
                        toolName: "deploy_presenter",
                        isError: false,
                        keys: ["runId", "role", "status"],
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "Your CEO approval package is filed as version 1 and ready to share with reviewers.",
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains:
                      "CEO approval package is filed as version 1",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "I've received Dana Chen's incorporated feedback to cap Phase 1 staffing at 2 engineers and will update our plan.",
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "--- reviewer feedback (external",
                    toolResults: [],
                  },
                },
              ]),
            },
            {
              runKey: "presenter-1",
              role: "presenter",
              stage: "presentation",
              sourceRunId: "run_pres_approval_1",
              exchanges: withRequiredTools(presenterTools, [
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "pres_skill",
                        name: "read_skill",
                        arguments: { name: "presenting" },
                      },
                      {
                        id: "pres_write_deck",
                        name: "write_deck",
                        arguments: {
                          deck,
                          assignment: {
                            audience: "ceo",
                            decisionNeeded: "Approve scope",
                            sources: [
                              {
                                artifactId: "{{bind:brief.artifactId}}",
                                kind: "problem_brief",
                                title: "Brief",
                                version: 1,
                                sha256: "{{bind:brief.sha256}}",
                              },
                            ],
                          },
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "# Presenter Assignment",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "pres_check_deck",
                        name: "check_deck",
                        arguments: {},
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "pres_skill",
                        toolName: "read_skill",
                        isError: false,
                      },
                      {
                        callId: "pres_write_deck",
                        toolName: "write_deck",
                        isError: false,
                        keys: [
                          "slides",
                          "deckPath",
                          "pptxPath",
                          "pdfPath",
                          "passed",
                          "issues",
                        ],
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "pres_file_pkg",
                        name: "file_package",
                        arguments: {},
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "pres_check_deck",
                        toolName: "check_deck",
                        isError: false,
                        contains: "check passed:",
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "The CEO approval package is filed as version 1.",
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "pres_file_pkg",
                        toolName: "file_package",
                        isError: false,
                        keys: ["artifactId", "kind", "version", "sha256"],
                      },
                    ],
                  },
                },
              ]),
            },
          ],
        );

        await withPipelineScenario(
          {
            fixtureDir,
            projectId: "weather-executive-pitch",
            title: "Weather Executive Pitch",
            problemStatement: "Build a Weather Executive Pitch for our CEO.",
          },
          async (driver) => {
            const { hub, projectTenantId, projectId } = driver;
            const { client, fakeCredentialSecret } = hub;

            await driver.runStage("documents", async () => {
              await driver.waitForAssistantTurn(
                "documents",
                "who this weather pitch is for",
              );
              await driver.sendMessage(["Open-Meteo."]);
              await driver.decideArtifactApproval({
                stage: "documents",
                kind: "problem_brief",
                version: 1,
                decision: "approve",
              });
            });

            await driver.runStage("presentation", async () => {
              await driver.waitForArtifactAndTurn(
                "presentation",
                { kind: "approval_package", version: 1 },
                "ready to share with reviewers",
              );
            });

            await driver.runStage("approval-round", async () => {
              const round = await client.startApprovalRound(
                projectTenantId,
                projectId,
                {
                  packageVersion: 1,
                  expiry: "7d",
                  reviewers: [
                    {
                      name: "Dana Chen",
                      persona: "CEO",
                      email: "dana.chen@example.com",
                      goal: "Approve Q3 staffing and scope",
                    },
                    {
                      name: "Marcus Vance",
                      persona: "CTO",
                      email: "marcus.vance@example.com",
                      goal: "Confirm Open-Meteo zero sign-in architecture",
                    },
                  ],
                },
              );
              expect(round.status).toBe("open");
              expect(round.packageVersion).toBe(1);
              expect(round.reviewers).toHaveLength(2);
              const dana = round.reviewers.find((r) => r.name === "Dana Chen")!;
              const marcus = round.reviewers.find(
                (r) => r.name === "Marcus Vance",
              )!;
              expect(dana.state).toBe("sent");
              expect(marcus.state).toBe("sent");

              const packageZip = await client.downloadPackageZip(
                projectTenantId,
                projectId,
                1,
                {
                  roundId: round.roundId,
                  reviewerId: dana.id,
                },
              );
              expect(packageZip.filename).toContain(
                "approval-package-for-dana-chen-ceo.zip",
              );
              expect(packageZip.archive.size).toBeGreaterThan(500);

              const afterDana = await client.recordReviewerDecision(
                projectTenantId,
                projectId,
                round.roundId,
                dana.id,
                {
                  outcome: "request_changes",
                  note: "- Cap Phase 1 staffing at 2 engineers\n- Keep zero sign-in scope",
                  slideNotes: [
                    { slide: 1, text: "Highlight the ask on slide 1" },
                  ],
                },
              );
              expect(afterDana.triage).toHaveLength(3);
              expect(
                afterDana.triage.every((item) => item.status === "pending"),
              ).toBe(true);

              const afterMarcus = await client.recordReviewerDecision(
                projectTenantId,
                projectId,
                round.roundId,
                marcus.id,
                {
                  outcome: "approve",
                  note: "- Architecture looks solid",
                },
              );
              expect(afterMarcus.triage).toHaveLength(4);

              const staffingItem = afterMarcus.triage.find((item) =>
                item.text.includes("Cap Phase 1 staffing at 2 engineers"),
              )!;
              const scopeItem = afterMarcus.triage.find((item) =>
                item.text.includes("Keep zero sign-in scope"),
              )!;
              const slideItem = afterMarcus.triage.find(
                (item) => item.slide === 1,
              )!;
              const ctoItem = afterMarcus.triage.find((item) =>
                item.text.includes("Architecture looks solid"),
              )!;

              const afterDismiss = await client.triageReviewerFeedback(
                projectTenantId,
                projectId,
                round.roundId,
                scopeItem.itemId,
                { action: "dismiss" },
              );
              expect(
                afterDismiss.triage.find(
                  (item) => item.itemId === scopeItem.itemId,
                )?.status,
              ).toBe("dismissed");

              const afterReply = await client.triageReviewerFeedback(
                projectTenantId,
                projectId,
                round.roundId,
                slideItem.itemId,
                {
                  action: "reply",
                  reply: "We will call out the ask on slide 1.",
                },
              );
              const repliedItem = afterReply.triage.find(
                (item) => item.itemId === slideItem.itemId,
              );
              expect(repliedItem?.status).toBe("replied");
              expect(repliedItem?.reply).toBe(
                "We will call out the ask on slide 1.",
              );

              await client.triageReviewerFeedback(
                projectTenantId,
                projectId,
                round.roundId,
                ctoItem.itemId,
                { action: "dismiss" },
              );

              const afterIncorporate = await client.triageReviewerFeedback(
                projectTenantId,
                projectId,
                round.roundId,
                staffingItem.itemId,
                { action: "incorporate" },
              );
              expect(
                afterIncorporate.triage.find(
                  (item) => item.itemId === staffingItem.itemId,
                )?.status,
              ).toBe("incorporated");

              await driver.waitForAssistantTurn(
                "approval-round",
                "cap Phase 1 staffing at 2 engineers",
              );

              const settled = await client.settleApprovalRound(
                projectTenantId,
                projectId,
                round.roundId,
              );
              expect(settled.status).toBe("settled");
              expect(settled.settledAt).toBeDefined();

              const listed = await client.approvalRounds(
                projectTenantId,
                projectId,
              );
              expect(listed.rounds).toHaveLength(1);
              expect(listed.rounds[0]?.status).toBe("settled");

              const finalArtifacts = await driver.assertArtifactStates([
                { kind: "problem_brief", version: 1, approvedVersion: 1 },
                { kind: "approval_package", version: 1, approvedVersion: 1 },
              ]);
              await driver.assertSecretRedacted(
                finalArtifacts,
                fakeCredentialSecret,
                1,
              );
            });
          },
        );
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    STAGE_DEADLINE_MS,
  );
});
