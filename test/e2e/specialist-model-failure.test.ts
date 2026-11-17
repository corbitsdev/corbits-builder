import { expect, test } from "bun:test";
import { type } from "arktype";
import { startTestHub } from "./support/hub.ts";
import {
  classifyRole,
  formatOpenAISseResponse,
  OpenAIChatRequest,
} from "./support/recorded-model.ts";

// A coordinator that starts a writer, whose every model call is refused as a bad login, the way a
// provider answers a revoked key.
function modelWithRejectedWriter() {
  const coordinatorRequests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: "recorded-replay", object: "model" }],
        });
      }
      const body = OpenAIChatRequest(await request.json());
      if (body instanceof type.errors) throw new Error(body.summary);
      const tools = new Set(
        (body.tools ?? []).flatMap((tool) =>
          tool.function?.name ? [tool.function.name] : [],
        ),
      );
      if (classifyRole(body, tools) !== "coordinator") {
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
      }
      coordinatorRequests.push(JSON.stringify(body.messages));
      const last = body.messages.at(-1);
      const reply = (turn: Parameters<typeof formatOpenAISseResponse>[0]) =>
        new Response(formatOpenAISseResponse(turn), {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      const call = (name: string, args: Record<string, unknown>) =>
        reply({ toolCalls: [{ id: `coord_${name}`, name, arguments: args }] });
      if (last?.role === "tool" && last.tool_call_id === "coord_execute") {
        return reply({ text: "The writer has started." });
      }
      if (last?.role === "user" && coordinatorRequests.length === 1) {
        return call("execute", {
          plugin: "writer",
          action: "write",
          input: {
            kind: "constraints",
            title: "Constraints: Weather app",
            instruction: "Write the constraints for a weather app for a team.",
          },
        });
      }
      return reply({ text: "Understood." });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    coordinatorSaw: (text: string) =>
      coordinatorRequests.some((messages) => messages.includes(text)),
    stop: () => server.stop(true),
  };
}

test("a specialist whose model rejects its sign-in fails, and the coordinator is told to reconnect", async () => {
  const model = modelWithRejectedWriter();
  const hub = await startTestHub(model);
  try {
    const { client, workspaceTenantId } = hub;
    const projectId = `specialist-login-rejected-${crypto.randomUUID()}`;
    await client.mutateProject(workspaceTenantId, projectId, {
      mutationId: `mut-${projectId}`,
      idempotencyKey: `idem-${projectId}`,
      command: "create_project",
      payload: {
        title: "Rejected specialist login",
        profile: "recorded_replay",
        problemStatement: "Build a weather app for our team.",
      },
    });
    const { tenantId } = await client.project(workspaceTenantId, projectId);

    let failedSpecialist: string | undefined;
    for (let i = 0; i < 200 && !failedSpecialist; i++) {
      await Bun.sleep(500);
      ({ failedSpecialist } = await client.projectNextStep(
        tenantId,
        projectId,
      ));
    }
    expect(failedSpecialist).toBe("writer");
    // The hub's notice loop mails the coordinator after the specialist ends.
    for (
      let i = 0;
      i < 40 && !model.coordinatorSaw("Reconnect the provider");
      i++
    )
      await Bun.sleep(500);
    expect(model.coordinatorSaw("Reconnect the provider")).toBe(true);
  } finally {
    await hub.close();
    await model.stop();
  }
}, 150_000);
