import { expect, test } from "bun:test";
import { startTestHub } from "./support/hub.ts";

// A model endpoint that lists its model but refuses every completion as a bad login, the way a
// provider answers a revoked key.
function rejectingModel() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: "recorded-replay", object: "model" }],
        });
      }
      return Response.json(
        {
          error: {
            message: "Incorrect API key provided.",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        { status: 401 },
      );
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

test("a person's message gets a plain reply when the coordinator's model rejects its sign-in", async () => {
  const model = rejectingModel();
  const hub = await startTestHub(model);
  try {
    const { client, workspaceTenantId } = hub;
    const projectId = `model-login-rejected-${crypto.randomUUID()}`;
    const question = "Build a weather app for our team.";
    await client.mutateProject(workspaceTenantId, projectId, {
      mutationId: `mut-${projectId}`,
      idempotencyKey: `idem-${projectId}`,
      command: "create_project",
      payload: {
        title: "Rejected login",
        profile: "recorded_replay",
        problemStatement: question,
      },
    });
    const { tenantId } = await client.project(workspaceTenantId, projectId);

    let reply: string | undefined;
    for (let i = 0; i < 120 && reply === undefined; i++) {
      await Bun.sleep(500);
      const { turns = [] } = await client.conversationEvents(
        tenantId,
        projectId,
      );
      const asked = turns.findIndex(
        (turn) => turn.role === "person" && turn.text === question,
      );
      if (asked !== -1)
        reply = turns
          .slice(asked + 1)
          .find((turn) => turn.role === "assistant")?.text;
    }
    expect(reply).toContain("Reconnect the provider");
    expect(reply).not.toContain("Incorrect API key");
  } finally {
    await hub.close();
    await model.stop();
  }
}, 120_000);
