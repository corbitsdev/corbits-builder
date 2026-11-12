import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectExport } from "@corbits-builder/schemas/project";
import { startTestHub, type TestHubHandle } from "./support/hub.ts";
import {
  buildWeatherApp,
  FIXTURE_DIR,
  NonEmptyString,
  STAGE_DEADLINE_MS,
  withPipelineScenario,
} from "./support/pipeline-driver.ts";
import {
  formatOpenAISseResponse,
  startRecordedModelServer,
  writeScenarioFixture,
  type RecordedModelServer,
} from "./support/recorded-model.ts";

const POLL_MS = 1_000;
const coordinatorTools = ["execute", "read_artifact"];
const coderTools = ["read_file", "edit_file", "run_shell", "mail_reply"];
// The skill pack the change calls for, as the coder's assignment lists it and its workspace holds it.
const routesPack = ".inputs/skills/web-app-skills/react-router-skills/";
const instruction =
  "Change the app's font to Inter for all text: set the body font-family to Inter in client/src/styles.css. Change nothing else.";
const themeImport = '@import "@corbits/react-ui/theme.css";\n';
const report = "All text is now set in Inter; check-app passed.";

async function until<T>(
  description: string,
  recordedModel: RecordedModelServer,
  check: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = performance.now() + STAGE_DEADLINE_MS;
  while (performance.now() < deadline) {
    const failure = recordedModel.firstFailure();
    if (failure) throw failure;
    const found = await check();
    if (found !== undefined) return found;
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test(
  "in dynamic mode a person's directed change to an imported app goes to a coder at once, with no approval and no document touched",
  async () => {
    let exported: ProjectExport | undefined;
    await withPipelineScenario(
      {
        fixtureDir: FIXTURE_DIR,
        projectId: "animated-weather-app",
        title: "Animated Weather App",
        problemStatement: "C: Weather App",
      },
      async (driver) => {
        await buildWeatherApp(driver);
        exported = await driver.hub.client.exportProject(
          driver.projectTenantId,
          driver.projectId,
        );
      },
    );
    if (!exported) throw new Error("The weather app was not exported");

    const fixtureDir = await mkdtemp(
      join(tmpdir(), "builder-e2e-directed-change-fixture-"),
    );
    let recordedModel: RecordedModelServer | undefined;
    let hub: TestHubHandle | undefined;
    try {
      await writeScenarioFixture(
        fixtureDir,
        { scenario: "directed-change", recordedFromCommit: "scripted" },
        [
          {
            runKey: "coordinator-1",
            role: "coordinator",
            stage: "change",
            sourceRunId: "run_directed_change_coordinator",
            exchanges: [
              {
                sse: formatOpenAISseResponse({
                  text: "The weather app is imported and built.",
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: "it can be changed directly",
                  requiredTools: coordinatorTools,
                  toolResults: [],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "coord_inter",
                      name: "execute",
                      arguments: {
                        plugin: "coder",
                        action: "change",
                        input: { instruction },
                      },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: "change the font to Inter",
                  requiredTools: coordinatorTools,
                  toolResults: [],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  text: "The coder is changing the font to Inter.",
                }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: coordinatorTools,
                  toolResults: [
                    {
                      callId: "coord_inter",
                      toolName: "execute",
                      isError: false,
                      keys: ["runId", "role"],
                    },
                  ],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  text: "Your app now uses Inter.",
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: report,
                  requiredTools: coordinatorTools,
                  toolResults: [],
                },
              },
            ],
          },
          {
            runKey: "coder-1",
            role: "coder",
            stage: "change",
            sourceRunId: "run_directed_change_coder",
            exchanges: [
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "coder_pack",
                      name: "read_file",
                      arguments: { path: routesPack + "routes.md" },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: `- react-router-skills (${routesPack})`,
                  requiredTools: coderTools,
                  toolResults: [],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "coder_inter",
                      name: "edit_file",
                      arguments: {
                        path: "client/src/styles.css",
                        old_string: themeImport,
                        new_string:
                          themeImport +
                          '\nbody {\n  font-family: "Inter", sans-serif;\n}\n',
                      },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: coderTools,
                  toolResults: [
                    {
                      callId: "coder_pack",
                      toolName: "read_file",
                      isError: false,
                    },
                  ],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "coder_inter_check",
                      name: "run_shell",
                      // The default 30 seconds is too short for check-app on a busy machine.
                      arguments: { command: "check-app", timeout: 180_000 },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: coderTools,
                  toolResults: [
                    {
                      callId: "coder_inter",
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
                  requiredTools: coderTools,
                  toolResults: [
                    {
                      callId: "coder_inter_check",
                      toolName: "run_shell",
                      isError: false,
                      contains: "The app is filed as version",
                    },
                  ],
                },
              },
            ],
          },
        ],
      );
      const model = await startRecordedModelServer(fixtureDir);
      recordedModel = model;
      hub = await startTestHub(model, { coordinatorMode: "dynamic" });
      const { client, workspaceTenantId } = hub;

      const { projectId } = await client.importProject(
        workspaceTenantId,
        exported,
      );
      const tenantId = (await client.project(workspaceTenantId, projectId))
        .tenantId;
      await until(
        "the coordinator to acknowledge the import",
        model,
        async () => {
          const { turns } = await client.conversationEvents(
            tenantId,
            projectId,
          );
          return turns?.some((turn) => turn.role === "assistant") || undefined;
        },
      );
      const documents = async () =>
        (await client.projectArtifacts(tenantId, projectId)).artifacts
          .filter((artifact) => artifact.kind !== "app")
          .map(({ kind, version, approvedVersion }) => ({
            kind,
            version,
            approvedVersion,
          }));
      const before = await documents();
      const decidedBefore = await client.decidedApprovals(tenantId, projectId);
      const imported = await client.appVersions(tenantId, projectId);
      expect(imported.versions.map((version) => version.source)).toEqual([
        "import",
      ]);

      const runId = NonEmptyString.assert(
        (await client.project(workspaceTenantId, projectId)).coordinatorRunId,
      );
      await client.sendMessage(tenantId, runId, {
        content: "change the font to Inter",
      });

      const coderRun = await until("a coder run to start", model, async () => {
        const { inFlight } = await client.projectArtifacts(tenantId, projectId);
        return inFlight.find((run) => run.role === "coder")?.runId;
      });
      const { data: approvals } = await client.nativeApprovals(tenantId);
      expect(
        approvals.filter((approval) => approval.status === "pending"),
      ).toEqual([]);

      await until(
        "the coder's report to reach the coordinator",
        model,
        async () => {
          const { turns } = await client.conversationEvents(
            tenantId,
            projectId,
          );
          return (
            turns?.some(
              (turn) =>
                turn.role === "assistant" &&
                turn.text.includes("Your app now uses Inter."),
            ) || undefined
          );
        },
      );
      const changed = await client.appVersions(tenantId, projectId);
      expect(
        changed.versions.map(({ source, runId: by }) => [source, by]),
      ).toEqual([
        ["check", coderRun],
        ["import", undefined],
      ]);
      expect(await documents()).toEqual(before);
      expect(await client.decidedApprovals(tenantId, projectId)).toEqual(
        decidedBefore,
      );
      model.assertClean();
    } finally {
      if (hub) await hub.close();
      if (recordedModel) await recordedModel.stop();
      await rm(fixtureDir, { recursive: true, force: true });
    }
  },
  STAGE_DEADLINE_MS * 4,
);
