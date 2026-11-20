import { expect, test } from "bun:test";
import { type } from "arktype";
import { like } from "drizzle-orm";
import { credential as credentialTable } from "@intx/db/schema";
import { startTestHub } from "./support/hub.ts";
import { formatOpenAISseResponse } from "./support/recorded-model.ts";

const completionRequest = type({
  messages: type({ role: "string", content: "unknown" }).array(),
});

// A model endpoint that answers every completion with a short reply and records the key and the
// last user message of each request.
function keyRecordingModel() {
  const calls: { authorization: string | null; lastUser: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models"))
        return Response.json({
          object: "list",
          data: [{ id: "recorded-replay", object: "model" }],
        });
      const body = completionRequest.assert(await request.json());
      const last = body.messages.findLast((m) => m.role === "user");
      calls.push({
        authorization: request.headers.get("authorization"),
        lastUser: JSON.stringify(last?.content ?? ""),
      });
      return new Response(formatOpenAISseResponse({ text: "Noted." }), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    calls,
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

// A person rotates the key of the provider their running coordinator uses; the coordinator's next
// model call carries the new key without a restart.
test("a running coordinator uses a rotated provider key on its next model call", async () => {
  const model = keyRecordingModel();
  const hub = await startTestHub(model);
  try {
    const { client, workspaceTenantId } = hub;
    const projectId = `rotation-${crypto.randomUUID()}`;
    const first = "First message before the rotation.";
    await client.mutateProject(workspaceTenantId, projectId, {
      mutationId: `mut-${projectId}`,
      idempotencyKey: `idem-${projectId}`,
      command: "create_project",
      payload: {
        title: "Rotation",
        profile: "recorded_replay",
        problemStatement: first,
      },
    });
    const { tenantId, coordinatorRunId } = await client.project(
      workspaceTenantId,
      projectId,
    );
    const callFor = async (text: string) => {
      for (let i = 0; i < 240; i++) {
        const call = model.calls.find((c) => c.lastUser.includes(text));
        if (call) return call;
        await Bun.sleep(500);
      }
      throw new Error(`no model call carried ${text}`);
    };
    const before = await callFor(first);
    const [credential] = await hub.db
      .select({ id: credentialTable.id, tenantId: credentialTable.tenantId })
      .from(credentialTable)
      .where(like(credentialTable.name, "custom-provider %"));
    const rotated = `sk-fake-rotated-${crypto.randomUUID()}`;
    const response = await fetch(
      `${hub.baseUrl}/api/tenants/${credential!.tenantId}/credentials/${credential!.id}`,
      {
        method: "PATCH",
        headers: {
          cookie: hub.cookie,
          origin: hub.baseUrl,
          "content-type": "application/json",
        },
        body: JSON.stringify({ secret: rotated }),
      },
    );
    expect(response.status).toBe(200);
    // The push is fire-and-forget; give it a moment to reach the sidecar.
    await Bun.sleep(1000);

    const second = "Second message after the rotation.";
    await client.sendMessage(tenantId, coordinatorRunId!, {
      content: second,
    });
    const after = await callFor(second);
    expect(before.authorization).not.toBe(`Bearer ${rotated}`);
    expect(after.authorization).toBe(`Bearer ${rotated}`);
  } finally {
    await hub.close();
    await model.stop();
  }
}, 180_000);
