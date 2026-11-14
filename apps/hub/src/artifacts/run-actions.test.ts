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

test("a run's start with a field the route does not take is refused, not silently dropped", async () => {
  const { app, recorded } = harness();
  const response = await app.request("/project-1/run-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: "run-1",
      plugin: "writer",
      action: "write-requirements",
      // A misspelt step would otherwise leave the run tied to no plan step.
      stepId: "step-1",
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "invalid_run_action" });
  expect(recorded).toEqual([]);
});
