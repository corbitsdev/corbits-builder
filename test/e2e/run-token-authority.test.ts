import { expect, test } from "bun:test";
import { type } from "arktype";
import { and, eq, ne } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant, workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { startTestHub } from "./support/hub.ts";
import {
  classifyRole,
  formatOpenAISseResponse,
  OpenAIChatRequest,
} from "./support/recorded-model.ts";
import { recorded } from "./support/scripted-project.ts";

// A coordinator that starts the recorded requirements writer, whose first model call waits until
// the test lets it go, so the writer's run token is live while the test uses it.
async function modelWithHeldWriter() {
  const writerTurns = await recorded("writer-4");
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let coordinatorCalls = 0;
  let writerCalls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models"))
        return Response.json({
          object: "list",
          data: [{ id: "recorded-replay", object: "model" }],
        });
      const body = OpenAIChatRequest(await request.json());
      if (body instanceof type.errors) throw new Error(body.summary);
      const tools = new Set(
        (body.tools ?? []).flatMap((tool) =>
          tool.function?.name ? [tool.function.name] : [],
        ),
      );
      const reply = (turn: Parameters<typeof formatOpenAISseResponse>[0]) =>
        new Response(formatOpenAISseResponse(turn), {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      if (classifyRole(body, tools) === "writer") {
        const turn = writerTurns[writerCalls++];
        if (!turn) throw new Error("The writer asked for an unscripted turn");
        if (writerCalls === 1) await released;
        return reply(turn.reply);
      }
      coordinatorCalls++;
      if (coordinatorCalls === 1)
        return reply({
          toolCalls: [
            {
              id: "c_requirements",
              name: "execute",
              arguments: {
                plugin: "writer",
                action: "write-requirements",
                input: {
                  instruction:
                    "An animated weather web app: current conditions, 24-hour and 7-day forecasts, saved cities and a compare view, using Open-Meteo.",
                },
              },
            },
          ],
        });
      return reply({ text: "A writer is on it." });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    writerWaiting: () => writerCalls > 0,
    release,
    stop: () => server.stop(true),
  };
}

test("a coordinator deploys a specialist without holding the person's admin authority, and a specialist cannot deploy", async () => {
  const model = await modelWithHeldWriter();
  const hub = await startTestHub(model);
  try {
    const { client, db, workspaceTenantId } = hub;
    const projectId = `run-token-authority-${crypto.randomUUID()}`;
    await client.mutateProject(workspaceTenantId, projectId, {
      mutationId: `mut-${projectId}`,
      idempotencyKey: `idem-${projectId}`,
      command: "create_project",
      payload: {
        title: "Weather",
        profile: "recorded_replay",
        problemStatement: "Build a weather app for our team.",
      },
    });
    const { tenantId, coordinatorRunId } = await client.project(
      workspaceTenantId,
      projectId,
    );
    for (let i = 0; i < 240 && !model.writerWaiting(); i++)
      await Bun.sleep(500);
    expect(model.writerWaiting()).toBe(true);

    const runPrincipal = async (runId: string) => {
      const [run] = await db
        .select({ principalId: workflowRun.principalId })
        .from(workflowRun)
        .where(eq(workflowRun.id, runId));
      return type("string").assert(run?.principalId);
    };
    const coordinator = await runPrincipal(
      type("string").assert(coordinatorRunId),
    );
    const [writerRun] = await db
      .select({ id: workflowRun.id })
      .from(workflowRun)
      .where(
        and(
          eq(workflowRun.tenantId, tenantId),
          ne(workflowRun.id, type("string").assert(coordinatorRunId)),
        ),
      );
    const writer = await runPrincipal(type("string").assert(writerRun?.id));
    const grantsOf = (principalId: string) =>
      db
        .select({
          resource: grant.resource,
          action: grant.action,
          effect: grant.effect,
          origin: grant.origin,
        })
        .from(grant)
        .where(eq(grant.principalId, principalId))
        .orderBy(grant.resource, grant.action);
    const tokens = createRunTokenStore({
      db,
      cipher: createEnvKeyCredentialCipher(
        hexDecode(type("string").assert(hub.env["CREDENTIAL_ENCRYPTION_KEY"])),
      ),
    });
    const asRun = async (
      principalId: string,
      method: "POST" | "PATCH",
      path: string,
      body: object,
    ) => {
      const [held] = await tokens.loadDelivery(principalId);
      if (!held) throw new Error(`${principalId} holds no run token`);
      return fetch(new URL(`/api/tenants/${tenantId}${path}`, hub.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${held.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    };

    for (const held of await grantsOf(coordinator)) {
      expect(held.resource).not.toBe("*");
      expect(held.action).not.toBe("*");
      if (["create", "manage"].includes(held.action))
        expect(held.resource).not.toMatch(
          /^(grant|role|principal|credential):/,
        );
    }
    // Its own declared requirements outlive Interchange's one-day invoker grants, narrowed to its project.
    const copies = (await grantsOf(coordinator))
      .filter((held) => held.origin === "system")
      .map((held) => `${held.effect} ${held.resource} ${held.action}`);
    expect(copies).toEqual(
      expect.arrayContaining([
        `allow sb-project:${projectId} read`,
        `allow sb-project:${projectId} manage`,
        "allow sb-artifact:* write",
        "allow workflow:* create",
        "allow asset:* read",
        "allow credential:* read",
      ]),
    );
    expect(copies.filter((copy) => copy.includes("sb-project:*"))).toEqual([]);
    expect(
      (
        await asRun(coordinator, "POST", "/roles", {
          name: "Taken over",
          grants: [{ resource: "*", action: "*", effect: "allow" }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await asRun(coordinator, "POST", "/grants", {
          principalId: coordinator,
          resource: "*",
          action: "*",
          effect: "allow",
        })
      ).status,
    ).toBe(403);
    expect(
      (await asRun(coordinator, "PATCH", "", { name: "Taken over" })).status,
    ).toBe(403);

    const writerGrants = await grantsOf(writer);
    expect(
      (await asRun(writer, "POST", "/workflows/deployments", {})).status,
    ).toBe(403);
    expect(await grantsOf(writer)).toEqual(writerGrants);

    model.release();
    let filed = false;
    for (let i = 0; i < 240 && !filed; i++) {
      await Bun.sleep(500);
      filed = (
        await client.projectArtifacts(tenantId, projectId)
      ).artifacts.some((item) => item.kind === "product_requirements");
    }
    expect(filed).toBe(true);

    // A permission the person no longer holds is not copied when the coordinator is reattached.
    const [launch] = await db
      .select({ person: workflowRunLaunchSpec.sourceAuthorityPrincipalId })
      .from(workflowRunLaunchSpec)
      .where(
        eq(
          workflowRunLaunchSpec.anchorRunId,
          type("string").assert(coordinatorRunId),
        ),
      );
    await db.insert(grant).values({
      id: `deny-${projectId}`,
      tenantId,
      principalId: type("string").assert(launch?.person),
      resource: "credential:*",
      action: "read",
      effect: "deny",
      origin: "system",
    });
    await db
      .delete(grant)
      .where(
        and(
          eq(grant.principalId, coordinator),
          eq(grant.origin, "system"),
          eq(grant.resource, "credential:*"),
        ),
      );
    await client.startProjectCoordinator(workspaceTenantId, projectId);
    const reattached = (await grantsOf(coordinator))
      .filter((held) => held.origin === "system")
      .map((held) => `${held.effect} ${held.resource} ${held.action}`);
    expect(reattached).toContain("allow asset:* read");
    expect(reattached).not.toContain("allow credential:* read");
  } finally {
    await hub.close();
    await model.stop();
  }
}, 300_000);
