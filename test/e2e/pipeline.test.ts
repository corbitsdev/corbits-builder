import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import { AskedQuestion } from "@intx/types/runtime-core";
import {
  buildWeatherApp,
  findArtifact,
  FIXTURE_DIR,
  isQuestionPark,
  NonEmptyString,
  openQuestionPark,
  STAGE_DEADLINE_MS,
  withPipelineScenario,
} from "./support/pipeline-driver.ts";
import { readRunConversation } from "./support/extract.ts";
import {
  formatOpenAISseResponse,
  loadScenarioBundle,
  writeScenarioFixture,
  type ExchangeExpectation,
} from "./support/recorded-model.ts";

const RecordedRole = type(
  "'coordinator' | 'designer' | 'coder' | 'presenter' | 'writer' | 'reviewer'",
);

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

          await buildWeatherApp(driver);

          await driver.runStage("build", async () => {
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
    "changes a built app's fonts to the person's pick-fonts choice through instruct_coder, and the coder's report reaches the coordinator",
    async () => {
      const fixtureDir = await mkdtemp(
        join(tmpdir(), "builder-e2e-font-change-fixture-"),
      );
      const coordinatorTools = ["question", "instruct_coder"];
      const coderTools = ["edit_file", "run_shell", "mail_reply"];
      // The filed design's secondary font, which the hub reads for the screen.
      const inUse = { proposed: { secondary: "Space Mono" } };
      const input = { proposed: { primary: "Arial" } };
      const fontKeys = ["look.font-primary", "look.font-secondary"];
      const chosen = {
        "look.font-primary": "Arial",
        "look.font-secondary": "Bitter",
      };
      // Entries of plugins/designer/data/fonts.json.
      const output = {
        primary: { name: "Arial", lists: ["sans"], license: "free" },
        secondary: { name: "Bitter", lists: ["serif"], license: "free" },
      };
      const themeImport = '@import "@corbits/react-ui/theme.css";\n';
      const report =
        "Body text is now Arial and headings are Bitter; check-app passed.";
      const fontTurns = withRequiredTools(coordinatorTools, [
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "coord_fonts_in_use",
                name: "question",
                arguments: {
                  plugin: "designer",
                  action: "pick-fonts",
                  input: inUse,
                },
              },
            ],
          }),
          expect: {
            lastMessageRole: "user",
            userTextContains: "the font is ugly",
            toolResults: [],
          },
        },
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "coord_fonts",
                name: "question",
                arguments: { plugin: "designer", action: "pick-fonts", input },
              },
            ],
          }),
          expect: {
            lastMessageRole: "tool",
            toolResults: [
              {
                callId: "coord_fonts_in_use",
                toolName: "question",
                isError: true,
                contains: [
                  "designer pick-fonts was not shown. One field is wrong.",
                  "",
                  'proposed: "Space Mono" is already the font in use.',
                  "",
                  'Your other fields were fine: list "all".',
                  "Call again proposing a different font, or with no proposal to let the person choose.",
                ].join("\n"),
              },
            ],
          },
        },
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "coord_font_change",
                name: "instruct_coder",
                arguments: {
                  instruction:
                    "Set the app's body text in Arial and its headings in Bitter, the fonts the person picked. Change nothing else.",
                },
              },
            ],
          }),
          expect: {
            lastMessageRole: "tool",
            toolResults: [
              {
                callId: "coord_fonts",
                toolName: "question",
                isError: false,
                keys: ["output"],
                contains: JSON.stringify({ output }),
              },
            ],
          },
        },
        {
          sse: formatOpenAISseResponse({
            text: "The coder is switching the fonts to Arial and Bitter.",
          }),
          expect: {
            lastMessageRole: "tool",
            toolResults: [
              {
                callId: "coord_font_change",
                toolName: "instruct_coder",
                isError: false,
                keys: ["runId", "role"],
              },
            ],
          },
        },
        {
          sse: formatOpenAISseResponse({
            text: "Your saved fonts are in the design.",
          }),
          expect: {
            lastMessageRole: "user",
            userTextContains:
              'The person saved look tweaks to the design in a new version of the filed design\'s styles.css: --font-sans: "Arial",',
            toolResults: [],
          },
        },
        {
          sse: formatOpenAISseResponse({
            text: "Your app now uses Arial and Bitter.",
          }),
          expect: {
            lastMessageRole: "user",
            userTextContains: report,
            toolResults: [],
          },
        },
      ]);
      const coderTurns = withRequiredTools(coderTools, [
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "coder_fonts",
                name: "edit_file",
                arguments: {
                  path: "client/src/styles.css",
                  old_string: themeImport,
                  new_string:
                    themeImport +
                    '\nbody {\n  font-family: "Arial", sans-serif;\n}\n\nh1,\nh2,\nh3 {\n  font-family: "Bitter", serif;\n}\n',
                },
              },
            ],
          }),
          expect: {
            lastMessageRole: "user",
            userTextContains: "Arial and its headings in Bitter",
            toolResults: [],
          },
        },
        {
          sse: formatOpenAISseResponse({
            toolCalls: [
              {
                id: "coder_fonts_check",
                name: "run_shell",
                arguments: { command: "check-app" },
              },
            ],
          }),
          expect: {
            lastMessageRole: "tool",
            toolResults: [
              {
                callId: "coder_fonts",
                toolName: "edit_file",
                isError: false,
              },
            ],
          },
        },
        {
          sse: formatOpenAISseResponse({ text: report }),
          expect: {
            lastMessageRole: "tool",
            toolResults: [
              {
                callId: "coder_fonts_check",
                toolName: "run_shell",
                isError: false,
                contains: "The app is filed as version 3.",
              },
            ],
          },
        },
      ]);
      const { manifest, runs } = await loadScenarioBundle(FIXTURE_DIR);
      try {
        await writeScenarioFixture(fixtureDir, manifest, [
          ...runs.map((run) => ({
            runKey: run.runKey,
            role: RecordedRole.assert(run.role),
            stage: run.stage,
            sourceRunId: run.sourceRunId,
            exchanges: [
              ...run.exchanges.map((exchange) => ({
                sse: exchange.responseSse,
                expect: exchange.expect,
              })),
              ...(run.runKey === "coordinator-1" ? fontTurns : []),
            ],
          })),
          {
            runKey: "coder-3",
            role: "coder",
            stage: "build",
            sourceRunId: "run_coder_font_change",
            exchanges: coderTurns,
          },
        ]);

        await withPipelineScenario(
          {
            fixtureDir,
            projectId: "animated-weather-app",
            title: "Animated Weather App",
            problemStatement: "C: Weather App",
          },
          async (driver) => {
            const { hub, projectTenantId, projectId } = driver;
            const { client } = hub;

            await buildWeatherApp(driver);

            await driver.runStage("font-change", async () => {
              const built = await client.decidedApprovals(
                projectTenantId,
                projectId,
              );
              const { artifacts } = await client.projectArtifacts(
                projectTenantId,
                projectId,
              );
              const design = await client.artifact(
                projectTenantId,
                projectId,
                NonEmptyString.assert(
                  findArtifact(artifacts, "design")?.artifactId,
                ),
              );
              const styles = type({
                files: { "designs/styles.css": "string" },
              }).assert(JSON.parse(design.content)).files["designs/styles.css"];
              expect(styles).toContain("--font-sans: system-ui,");
              expect(styles).toContain('--font-mono: "Space Mono",');
              expect(
                await client.projectValues(
                  projectTenantId,
                  projectId,
                  fontKeys,
                ),
              ).toEqual({
                values: {
                  "look.font-primary": "system-ui",
                  "look.font-secondary": "Space Mono",
                },
              });

              await driver.sendMessage(["the font is ugly"]);
              const shown = await driver.waitFor(
                "font-change",
                "the coordinator's pick-fonts question in its run log",
                async () => {
                  const { events } = await client.conversationEvents(
                    projectTenantId,
                    projectId,
                  );
                  return openQuestionPark(events);
                },
              );
              // The refused call never parked: the only question the run asked is the valid one.
              const { events } = await client.conversationEvents(
                projectTenantId,
                projectId,
              );
              expect(events.filter(isQuestionPark)).toEqual([shown]);
              expect(shown.body["question"]).toEqual({
                plugin: "designer",
                action: "pick-fonts",
                input,
              });

              // The hub saves the fonts the screen's output names as design tweaks, then
              // returns the output to the run.
              await client.answerQuestion(
                projectTenantId,
                projectId,
                NonEmptyString.assert(shown.body["signalName"]),
                { output },
              );
              expect(
                await client.projectValues(
                  projectTenantId,
                  projectId,
                  fontKeys,
                ),
              ).toEqual({ values: chosen });
              await driver.assertArtifactStates([
                { kind: "problem_brief", version: 1, approvedVersion: 1 },
                { kind: "constraints", version: 1, approvedVersion: 1 },
                { kind: "approaches", version: 2, approvedVersion: 2 },
                {
                  kind: "product_requirements",
                  version: 1,
                  approvedVersion: 1,
                },
                { kind: "design", version: 2, approvedVersion: 1 },
                { kind: "build_plan", version: 1, approvedVersion: 1 },
                { kind: "app", version: 2 },
              ]);
              await driver.decideToolApproval({
                stage: "font-change",
                toolName: "instruct_coder",
              });
              await driver.waitForArtifactAndTurn(
                "font-change",
                { kind: "app", version: 3 },
                "Your app now uses Arial and Bitter.",
              );

              const appVersions = await client.appVersions(
                projectTenantId,
                projectId,
              );
              expect(appVersions.versions.map((v) => v.version)).toEqual([
                3, 2, 1,
              ]);
              expect(appVersions.versions[0]?.source).toBe("check");
              // Only the saved fonts wrote the design again, and nothing was sent for approval:
              // the change's only approval is the instruction itself, which covers the design
              // with the saved fonts.
              await driver.assertArtifactStates([
                { kind: "problem_brief", version: 1, approvedVersion: 1 },
                { kind: "constraints", version: 1, approvedVersion: 1 },
                { kind: "approaches", version: 2, approvedVersion: 2 },
                {
                  kind: "product_requirements",
                  version: 1,
                  approvedVersion: 1,
                },
                { kind: "design", version: 2, approvedVersion: 2 },
                { kind: "build_plan", version: 1, approvedVersion: 1 },
                { kind: "app", version: 3 },
              ]);
              const decided = await client.decidedApprovals(
                projectTenantId,
                projectId,
              );
              const earlier = new Set(
                built.approvals.map((approval) => approval.approvalId),
              );
              expect(
                decided.approvals
                  .filter((approval) => !earlier.has(approval.approvalId))
                  .map((approval) => [approval.toolName, approval.status]),
              ).toEqual([["instruct_coder", "approved"]]);
            });
          },
        );
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
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

  test(
    "pauses the coordinator on its question until the person answers by id, then continues with the answers",
    async () => {
      const fixtureDir = await mkdtemp(
        join(tmpdir(), "builder-e2e-question-fixture-"),
      );
      const coordinatorTools = ["question", "read_artifact", "write_artifact"];
      try {
        await writeScenarioFixture(
          fixtureDir,
          { scenario: "bakery-orders-question", recordedFromCommit: "8eecc04" },
          [
            {
              runKey: "coordinator-1",
              role: "coordinator",
              stage: "documents",
              sourceRunId: "run_coord_question_1",
              exchanges: withRequiredTools(coordinatorTools, [
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_question",
                        name: "question",
                        arguments: {
                          questions: [
                            {
                              header: "Audience",
                              question: "Who takes the orders?",
                              options: [
                                {
                                  label: "The owner (Recommended)",
                                  description: "One person runs the list.",
                                },
                                {
                                  label: "Counter staff",
                                  description: "Whoever is on shift.",
                                },
                              ],
                            },
                          ],
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "Bakery Orders",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "Counter staff it is; I will write the brief for them.",
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_question",
                        toolName: "question",
                        isError: false,
                        keys: ["answers"],
                        contains: "Counter staff",
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
            projectId: "bakery-orders",
            title: "Bakery Orders",
            problemStatement: "Build Bakery Orders for our shop.",
          },
          async (driver) => {
            const { hub, projectTenantId, projectId } = driver;
            const { client } = hub;

            await driver.runStage("question", async () => {
              const parked = await driver.waitFor(
                "question",
                "the coordinator's open question in its run log",
                async () => {
                  const { events } = await client.conversationEvents(
                    projectTenantId,
                    projectId,
                  );
                  return events.find(isQuestionPark);
                },
              );
              const signalName = type("string > 0").assert(
                parked.body["signalName"],
              );
              const question = AskedQuestion.assert(parked.body["question"]);
              if ("plugin" in question)
                throw new Error("the parked question shows a screen");
              const [asked] = question.questions;
              if (asked === undefined)
                throw new Error("the parked question carries no prompt");
              expect(asked.header).toBe("Audience");

              // Only the open question's own ids answer it.
              await expect(
                client.answerQuestion(projectTenantId, projectId, signalName, {
                  answers: { "not-a-question": ["Counter staff"] },
                }),
              ).rejects.toThrow();

              await client.answerQuestion(
                projectTenantId,
                projectId,
                signalName,
                { answers: { [asked.id]: ["Counter staff"] } },
              );
              await driver.waitForAssistantTurn(
                "question",
                "Counter staff it is",
              );

              const { events } = await client.conversationEvents(
                projectTenantId,
                projectId,
              );
              const received = events.find(
                (event) =>
                  event.type === "SignalReceived" &&
                  event.body["signalName"] === signalName,
              );
              expect(received?.body["payload"]).toEqual({
                answers: { [asked.id]: ["Counter staff"] },
              });
            });
          },
        );
      } finally {
        await rm(fixtureDir, { recursive: true, force: true });
      }
    },
    STAGE_DEADLINE_MS,
  );

  test(
    "refuses a pick-fonts input it cannot draw without asking the person, then shows a valid one and returns its output or the person's reply",
    async () => {
      const fixtureDir = await mkdtemp(
        join(tmpdir(), "builder-e2e-screen-question-fixture-"),
      );
      const coordinatorTools = ["question", "read_artifact", "write_artifact"];
      // Nothing proposed: the person chooses from every font.
      const input = {};
      // Entries of plugins/designer/data/fonts.json.
      const output = {
        primary: { name: "Arial", lists: ["sans"], license: "free" },
        secondary: { name: "Bitter", lists: ["serif"], license: "free" },
      };
      const reply = "Leave the fonts as they are.";
      try {
        await writeScenarioFixture(
          fixtureDir,
          { scenario: "font-change-question", recordedFromCommit: "36d36e8" },
          [
            {
              runKey: "coordinator-1",
              role: "coordinator",
              stage: "documents",
              sourceRunId: "run_coord_screen_1",
              exchanges: withRequiredTools(coordinatorTools, [
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_bad_list",
                        name: "question",
                        arguments: {
                          plugin: "designer",
                          action: "pick-fonts",
                          input: { list: "fancy" },
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "user",
                    userTextContains: "the font is ugly",
                    toolResults: [],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_fonts",
                        name: "question",
                        arguments: {
                          plugin: "designer",
                          action: "pick-fonts",
                          input,
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_bad_list",
                        toolName: "question",
                        isError: true,
                        contains: [
                          "designer pick-fonts was not shown. One field is wrong.",
                          "",
                          'list: "fancy" is not a list.',
                          "  Use one of:",
                          "    all      Every font. Use when the person has no preference.",
                          "    sans     Clean and modern. Good for apps and dashboards.",
                          "    serif    Classic and bookish. Good for long reading and editorial pages.",
                          "    display  Loud and characterful. Good for headings and logos, not body text.",
                          "    mono     Every letter the same width. Good for code and figures.",
                          "  Or pass up to 20 font names. Or leave list out to offer every font.",
                          "",
                          "Call again with the same input and list corrected.",
                        ].join("\n"),
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    toolCalls: [
                      {
                        id: "coord_fonts_again",
                        name: "question",
                        arguments: {
                          plugin: "designer",
                          action: "pick-fonts",
                          input,
                        },
                      },
                    ],
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_fonts",
                        toolName: "question",
                        isError: false,
                        keys: ["output"],
                        contains: JSON.stringify({ output }),
                      },
                    ],
                  },
                },
                {
                  sse: formatOpenAISseResponse({
                    text: "Keeping the fonts you have.",
                  }),
                  expect: {
                    lastMessageRole: "tool",
                    toolResults: [
                      {
                        callId: "coord_fonts_again",
                        toolName: "question",
                        isError: false,
                        keys: ["reply"],
                        contains: JSON.stringify({ reply }),
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
            projectId: "font-change",
            title: "Font Change",
            problemStatement: "the font is ugly",
          },
          async (driver) => {
            const { hub, projectTenantId, projectId, coordinatorRunId } =
              driver;
            const { client } = hub;
            const openQuestion = async () => {
              const { events } = await client.conversationEvents(
                projectTenantId,
                projectId,
              );
              return openQuestionPark(events);
            };

            await driver.runStage("screen-question", async () => {
              const shown = await driver.waitFor(
                "screen-question",
                "the coordinator's pick-fonts question in its run log",
                openQuestion,
              );
              // The refused call never parked: the only question the run asked is the valid one.
              const { events } = await client.conversationEvents(
                projectTenantId,
                projectId,
              );
              expect(events.filter(isQuestionPark)).toEqual([shown]);
              expect(shown.body["question"]).toEqual({
                plugin: "designer",
                action: "pick-fonts",
                input,
              });
              const shownSignal = NonEmptyString.assert(
                shown.body["signalName"],
              );

              await client.answerQuestion(
                projectTenantId,
                projectId,
                shownSignal,
                { output },
              );
              const asked = await driver.waitFor(
                "screen-question",
                "the coordinator's next question after the screen's output",
                async () => {
                  const park = await openQuestion();
                  return park?.body["signalName"] === shownSignal
                    ? undefined
                    : park;
                },
              );
              const answered = await client.conversationEvents(
                projectTenantId,
                projectId,
              );
              expect(
                answered.events.find(
                  (event) =>
                    event.type === "SignalReceived" &&
                    event.body["signalName"] === shownSignal,
                )?.body["payload"],
              ).toEqual({ output });
              const askedSignal = NonEmptyString.assert(
                asked.body["signalName"],
              );

              // A screen is answered by its output or a reply, never by prompt ids.
              await expect(
                client.answerQuestion(projectTenantId, projectId, askedSignal, {
                  answers: { primary: ["Arial"] },
                }),
              ).rejects.toThrow("Bad Request");

              await client.answerQuestion(
                projectTenantId,
                projectId,
                askedSignal,
                { reply },
              );
              await driver.waitForAssistantTurn(
                "screen-question",
                "Keeping the fonts you have.",
              );
              expect(await openQuestion()).toBeUndefined();

              // The refused call never parked, so only the stored conversation shows it.
              const stored = await readRunConversation(
                hub,
                coordinatorRunId,
                "coordinate",
              );
              const [refused] = stored.toolCalls;
              expect(refused?.name).toBe("question");
              expect(refused?.arguments).toEqual({
                plugin: "designer",
                action: "pick-fonts",
                input: { list: "fancy" },
              });
              expect(refused?.result?.isError).toBe(true);
              expect(refused?.result?.text).toContain(
                "designer pick-fonts was not shown",
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

  test(
    "notes pick-fonts under the person's message to the coordinator when the hub hints by fields, and shows the person only their words",
    async () => {
      const fixtureDir = await mkdtemp(
        join(tmpdir(), "builder-e2e-plugin-hint-fixture-"),
      );
      const hint =
        'Open it with question({ plugin: "designer", action: "pick-fonts" })';
      try {
        await writeScenarioFixture(
          fixtureDir,
          { scenario: "font-plugin-hint", recordedFromCommit: "1bee520" },
          [
            {
              runKey: "coordinator-1",
              role: "coordinator",
              stage: "documents",
              sourceRunId: "run_coord_hint_1",
              exchanges: withRequiredTools(
                ["question"],
                [
                  {
                    sse: formatOpenAISseResponse({
                      text: "What would you like to change?",
                    }),
                    expect: {
                      lastMessageRole: "user",
                      userTextContains: "Font Hint",
                      toolResults: [],
                    },
                  },
                  {
                    sse: formatOpenAISseResponse({
                      text: "The fonts can change.",
                    }),
                    expect: {
                      lastMessageRole: "user",
                      userTextContains: hint,
                      toolResults: [],
                    },
                  },
                ],
              ),
            },
          ],
        );

        await withPipelineScenario(
          {
            fixtureDir,
            projectId: "font-hint",
            title: "Font Hint",
            problemStatement: "Build Font Hint for our shop.",
            hub: { pluginHint: "fields" },
          },
          async (driver) => {
            const { hub, projectTenantId, projectId, coordinatorRunId } =
              driver;

            await driver.runStage("hint", async () => {
              await driver.waitForAssistantTurn(
                "hint",
                "What would you like to change?",
              );
              await driver.sendMessage(["the font is ugly"]);
              await driver.waitForAssistantTurn(
                "hint",
                "The fonts can change.",
              );

              const stored = await readRunConversation(
                hub,
                coordinatorRunId,
                "coordinate",
              );
              const sent = stored.personTexts.at(-1);
              expect(sent).toContain("the font is ugly");
              expect(sent).toContain(hint);
              expect(sent).toEndWith(
                "If none fits, call discover or carry on without a plugin.",
              );
              const { turns } = await hub.client.conversationEvents(
                projectTenantId,
                projectId,
              );
              expect(
                turns
                  ?.filter((turn) => turn.role === "person")
                  .map((turn) => turn.text),
              ).toEqual(["Build Font Hint for our shop.", "the font is ugly"]);
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
