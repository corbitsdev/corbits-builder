import { expect, test } from "bun:test";
import { type } from "arktype";
import { and, eq, like } from "drizzle-orm";
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
    const listing = await client.project(workspaceTenantId, projectId);
    const coordinatorRunId = type("string > 0").assert(
      listing.coordinatorRunId,
    );
    const callFor = (text: string) =>
      model.calls.find((c) => c.lastUser.includes(text));
    const firstDeadline = performance.now() + 60_000;
    while (!callFor(first) && performance.now() < firstDeadline)
      await Bun.sleep(500);
    expect(callFor(first)?.authorization).toStartWith(
      "Bearer sk-fake-e2e-secret-",
    );

    const [credential] = await hub.db
      .select({ id: credentialTable.id })
      .from(credentialTable)
      .where(
        and(
          eq(credentialTable.tenantId, workspaceTenantId),
          like(credentialTable.name, "custom-provider %"),
        ),
      );
    if (!credential)
      throw new Error("the workspace has no provider credential");
    const rotated = `sk-fake-rotated-${crypto.randomUUID()}`;
    const response = await fetch(
      `${hub.baseUrl}/api/tenants/${workspaceTenantId}/credentials/${credential.id}`,
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

    // The hub pushes the rotation without awaiting it, so keep messaging the coordinator until a
    // model call carries the new key.
    const deadline = performance.now() + 60_000;
    let rotatedKeyUsed = false;
    for (
      let sent = 1;
      !rotatedKeyUsed && performance.now() < deadline;
      sent++
    ) {
      const text = `Message ${sent} after the rotation.`;
      await client.sendMessage(listing.tenantId, coordinatorRunId, {
        content: text,
      });
      while (!callFor(text) && performance.now() < deadline)
        await Bun.sleep(500);
      rotatedKeyUsed = callFor(text)?.authorization === `Bearer ${rotated}`;
    }
    if (!rotatedKeyUsed)
      throw new Error(
        "Timed out after 60s waiting for a model call with the rotated key",
      );
  } finally {
    await hub.close();
    await model.stop();
  }
}, 180_000);
