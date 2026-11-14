import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { ProjectError } from "../projects/errors.ts";
import { mountArtifactRoutes } from "./routes.ts";
import type { createArtifactService } from "./service.ts";

// The route a coordinator's tools call when they start a run, with a service that records nothing.
function harness() {
  const recorded: unknown[] = [];
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code, ...error.details }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("tenant", { id: "tenant-1" } as TenantEnv["Variables"]["tenant"]);
    c.set("principal", {
      id: "coordinator-principal",
    } as TenantEnv["Variables"]["principal"]);
    await next();
  });
  const service = {
    recordRunAction: async (...args: unknown[]) => {
      recorded.push(args);
      return {};
    },
  } as unknown as ReturnType<typeof createArtifactService>;
  mountArtifactRoutes(app, service);
  return { app, recorded };
}

test("an agent cannot say a run was started on the person's request: the hub reads that itself", async () => {
  const { app, recorded } = harness();
  for (const claim of [
    { requestedBy: "person-1" },
    { requestRunId: "coordinator-run", requestSignalId: "<m2@example.com>" },
    { carriedFrom: 1 },
  ]) {
    const response = await app.request("/project-1/run-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "run-1",
        plugin: "writer",
        action: "write-requirements",
        ...claim,
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_run_action" });
  }
  expect(recorded).toEqual([]);
});
