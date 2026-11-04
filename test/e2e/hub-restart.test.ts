import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestHub, type TestHubHandle } from "./support/hub.ts";
import {
  formatOpenAISseResponse,
  startRecordedModelServer,
  writeScenarioFixture,
  type RecordedModelServer,
} from "./support/recorded-model.ts";

const DEADLINE_MS = 180_000;
const COORDINATOR_TOOLS = [
  "read_artifact",
  "write_artifact",
  "request_approval",
  "deploy_writer",
];
const WRITER_TOOLS = ["write_artifact"];

async function poll<T>(
  recordedModel: RecordedModelServer,
  description: string,
  check: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const failure = recordedModel.firstFailure();
    if (failure) throw failure;
    const found = await check();
    if (found !== undefined) return found;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// A writer whose model reply is still in flight when the hub restarts. The sidecar outlives the hub, the new hub
// adopts it, and the writer's turn files its document as if nothing happened: no failed run, and no notice that would
// send the coordinator an exchange the recording does not have.
test(
  "a specialist mid-turn finishes its turn across a hub restart",
  async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "builder-e2e-restart-"));
    let recordedModel: RecordedModelServer | undefined;
    let hub: TestHubHandle | undefined;
    try {
      await writeScenarioFixture(
        fixtureDir,
        { scenario: "hub-restart-mid-turn", recordedFromCommit: "3038faa" },
        [
          {
            runKey: "coordinator-1",
            role: "coordinator",
            stage: "documents",
            sourceRunId: "run_coord_restart_1",
            exchanges: [
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
                  userTextContains: "Restart Pitch",
                  requiredTools: COORDINATOR_TOOLS,
                  toolResults: [],
                },
              },
              {
                sse: formatOpenAISseResponse({
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
                  requiredTools: COORDINATOR_TOOLS,
                  toolResults: [
                    {
                      callId: "coord_write_brief",
                      toolName: "write_artifact",
                      isError: false,
                    },
                  ],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "coord_deploy_constraints",
                      name: "deploy_writer",
                      arguments: {
                        kind: "constraints",
                        instruction:
                          "Write the constraints for the restart pitch from its brief.",
                      },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: COORDINATOR_TOOLS,
                  toolResults: [
                    {
                      callId: "coord_approve_brief",
                      toolName: "request_approval",
                      isError: false,
                    },
                  ],
                },
              },
              {
                sse: formatOpenAISseResponse({ text: "Writer started." }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: COORDINATOR_TOOLS,
                  toolResults: [
                    {
                      callId: "coord_deploy_constraints",
                      toolName: "deploy_writer",
                      isError: false,
                      keys: ["runId", "role", "status"],
                    },
                  ],
                },
              },
              {
                sse: formatOpenAISseResponse({
                  text: "The constraints are filed as version 1.",
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: "Constraints filed.",
                  requiredTools: COORDINATOR_TOOLS,
                  toolResults: [],
                },
              },
            ],
          },
          {
            runKey: "writer-1",
            role: "writer",
            stage: "documents",
            sourceRunId: "run_writer_restart_1",
            exchanges: [
              {
                sse: formatOpenAISseResponse({
                  toolCalls: [
                    {
                      id: "writer_write",
                      name: "write_artifact",
                      arguments: {
                        title: "Constraints",
                        content: "Constraints",
                      },
                    },
                  ],
                }),
                expect: {
                  lastMessageRole: "user",
                  userTextContains: '"artifact":"constraints"',
                  requiredTools: WRITER_TOOLS,
                  toolResults: [],
                },
              },
              {
                sse: formatOpenAISseResponse({ text: "Constraints filed." }),
                expect: {
                  lastMessageRole: "tool",
                  requiredTools: WRITER_TOOLS,
                  toolResults: [
                    {
                      callId: "writer_write",
                      toolName: "write_artifact",
                      isError: false,
                      keys: ["artifactId", "kind", "version", "sha256"],
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
      const writerTurn = model.hold("writer-1", 0);
      let writing = false;
      void writerTurn.reached.then(() => (writing = true));
      // The ask's time comes from Postgres's clock and the brief's from the hub's, so the ask waits until the brief
      // is plainly older than it.
      const ask = model.hold("coordinator-1", 1);
      void ask.reached.then(async () => {
        await Bun.sleep(1_000);
        ask.release();
      });
      const started = await startTestHub(model);
      hub = started;
      const { client, workspaceTenantId } = started;
      const projectId = "restart-pitch";
      await client.mutateProject(workspaceTenantId, projectId, {
        mutationId: `mut-create-${projectId}`,
        idempotencyKey: `idem-create-${projectId}`,
        command: "create_project",
        payload: {
          title: "Restart Pitch",
          profile: "recorded_replay",
          problemStatement: "Restart Pitch",
        },
      });
      const { tenantId } = await client.project(workspaceTenantId, projectId);

      const approval = await poll(model, "the brief approval", async () => {
        const { data } = await client.nativeApprovals(tenantId);
        return data.find(
          (item) =>
            item.status === "pending" &&
            item.toolDefinition["name"] === "request_approval",
        );
      });
      await client.decideNativeApproval(
        tenantId,
        approval.id,
        "approve",
        "once",
      );

      await poll(model, "the writer's turn", async () => writing || undefined);
      await started.restart();
      writerTurn.release();

      await poll(model, "the coordinator's reply to the writer", async () => {
        const { turns } = await client.conversationEvents(tenantId, projectId);
        return turns?.find(
          (turn) =>
            turn.role === "assistant" &&
            turn.text.includes("filed as version 1"),
        );
      });
      const { artifacts, failed } = await client.projectArtifacts(
        tenantId,
        projectId,
      );
      expect(failed).toEqual([]);
      expect(
        artifacts.find((item) => item.kind === "constraints")?.version,
      ).toBe(1);
      model.assertClean();
    } finally {
      await hub?.close();
      await recordedModel?.stop();
      await rm(fixtureDir, { recursive: true, force: true });
    }
  },
  DEADLINE_MS * 2,
);
