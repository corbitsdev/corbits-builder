import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { DB } from "@intx/db";
import { createMiddleware } from "hono/factory";
import type { RequireGrant, TenantEnv } from "@intx/hub-api";
import { createSidecarRouter, findRoutableById } from "@intx/hub-sessions";
import type { InferenceEvent } from "@intx/types/runtime";
import { createWorkflowRunStreamRoutes } from "./run-stream.ts";

type Routable = Awaited<ReturnType<typeof findRoutableById>>;

const tenantId = "tenant-a";
const runId = "run-a";
const runAddress = "run-a@stream.test";
const sidecarRouter = createSidecarRouter({
  authenticateSidecar: async () => null,
  validateSidecarIdentity: async () => false,
  withExecutableWorkflowRun: async () => false,
  resolveSidecarBindings: async () => [],
});

const requireGrant: RequireGrant = () =>
  createMiddleware<TenantEnv>(async (c, next) => {
    if (c.get("user") === null || c.get("user") === undefined) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
    c.set("tenant", { id: tenantId } as TenantEnv["Variables"]["tenant"]);
    await next();
  });

function appFor(findRun: typeof findRoutableById) {
  const app = new Hono<TenantEnv>();
  app.use("/api/tenants/:tenantId/*", async (c, next) => {
    const authUser = c.req.header("x-test-user-id");
    c.set(
      "user",
      authUser ? ({ id: authUser } as TenantEnv["Variables"]["user"]) : null,
    );
    await next();
  });
  app.route(
    "/api/tenants/:tenantId",
    createWorkflowRunStreamRoutes({
      db: {} as DB["db"],
      sidecarRouter,
      requireGrant,
      findRun,
    }),
  );
  return app;
}

const findRun: typeof findRoutableById = async (_db, id, tenant) => {
  if (id === runId && tenant === tenantId)
    return { address: runAddress } as NonNullable<Routable>;
  return undefined;
};

test("rejects an unauthenticated stream and an unknown run", async () => {
  const app = appFor(findRun);
  const unauth = await app.request(
    `/api/tenants/${tenantId}/workflows/runs/${runId}/stream`,
  );
  expect(unauth.status).toBe(401);

  const missing = await app.request(
    `/api/tenants/${tenantId}/workflows/runs/run-missing/stream`,
    {
      headers: { "x-test-user-id": "user-a" },
    },
  );
  expect(missing.status).toBe(404);
});

test("streams live InferenceEvent frames and drops anything else", async () => {
  const app = appFor(findRun);
  const abort = new AbortController();
  const res = await app.request(
    `/api/tenants/${tenantId}/workflows/runs/${runId}/stream`,
    {
      headers: { "x-test-user-id": "user-a" },
      signal: abort.signal,
    },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const startEvent: InferenceEvent = {
    type: "inference.start",
    seq: 1,
    data: { model: "fixture-model" },
  };
  const deltaEvent: InferenceEvent = {
    type: "inference.text.delta",
    seq: 2,
    data: { token: "Hello", partial: { text: "Hello" } },
  };
  sidecarRouter.dispatchAgentEvent(runAddress, {
    type: "turn.committed",
    data: { turnId: "t1" },
  });
  sidecarRouter.dispatchAgentEvent(runAddress, startEvent);
  sidecarRouter.dispatchAgentEvent(runAddress, deltaEvent);

  let buffer = "";
  const received: unknown[] = [];
  while (received.length < 2) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (
        eventLine?.slice("event:".length).trim() === "run" &&
        dataLine !== undefined
      ) {
        received.push(JSON.parse(dataLine.slice("data:".length).trim()));
      }
    }
  }

  abort.abort();
  await reader.cancel();
  expect(received).toEqual([startEvent, deltaEvent]);
});

test("forwards delivered mail and a lost route without mail content", async () => {
  const app = appFor(findRun);
  const abort = new AbortController();
  const res = await app.request(
    `/api/tenants/${tenantId}/workflows/runs/${runId}/stream`,
    {
      headers: { "x-test-user-id": "user-a" },
      signal: abort.signal,
    },
  );
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  sidecarRouter.dispatchAgentEvent(runAddress, {
    type: "mail.delivered",
    data: {
      id: "mail-1",
      direction: "inbound",
      subject: "Private",
      body: "Private",
    },
  });
  sidecarRouter.events.emit("sidecar.disconnect", {
    ownedAddresses: ["other@x"],
    allocated: [],
  });
  sidecarRouter.events.emit("sidecar.disconnect", {
    ownedAddresses: [runAddress],
    allocated: [],
  });

  let buffer = "";
  const received: { event: string; data: unknown }[] = [];
  while (received.length < 2) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.slice("event:".length)
        .trim();
      const data = lines
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length)
        .trim();
      if (event === "mail" || event === "status")
        received.push({ event, data: JSON.parse(data!) });
    }
  }

  abort.abort();
  await reader.cancel();
  expect(received).toEqual([
    { event: "mail", data: { id: "mail-1", direction: "inbound" } },
    { event: "status", data: { routable: false } },
  ]);
});
