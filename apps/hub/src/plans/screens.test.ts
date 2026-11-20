import { expect, test } from "bun:test";
import { join } from "node:path";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import type { createArtifactService } from "../artifacts/service.ts";
import { HOST, PLUGINS_FOLDER } from "../plugins/catalog.ts";
import type { Checks } from "../plugins/checks.ts";
import { projectRead, shownScreens } from "../plugins/screens.ts";
import { ProjectError } from "../projects/errors.ts";
import { mountPlanRoutes } from "./routes.ts";
import type { createPlanService } from "./service.ts";

// The plan routes on the real plugins, with the project's records and writes held in memory.
function hub(project: { artifacts: { kind: string; version: number }[] }) {
  const added: unknown[] = [];
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code }, error.status);
    throw error;
  });
  const at = new Date();
  app.use("*", async (c, next) => {
    c.set("tenant", {
      id: "tenant-1",
      name: "Tenant",
      slug: "tenant",
      domain: "tenant.test",
      parentId: null,
      config: {},
      createdAt: at,
      updatedAt: at,
    });
    c.set("principal", {
      id: "principal-1",
      tenantId: "tenant-1",
      kind: "user",
      refId: "user-1",
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
    await next();
  });
  const artifacts = {
    projectState: async () => ({
      styles: undefined,
      stored: {},
      materials: [],
    }),
    list: async () => ({ artifacts: project.artifacts, preferences: {} }),
    stepRuns: async () => [],
  } as unknown as ReturnType<typeof createArtifactService>;
  const plans = {
    projectPlan: async () => ({ steps: [], updatedAt: null }),
    addPlanStep: async (_actor: unknown, _project: unknown, step: unknown) => {
      added.push(step);
    },
  } as unknown as ReturnType<typeof createPlanService>;
  const checks = { latest: async () => [] } as unknown as Checks;
  const conversation = async () =>
    Response.json({ runId: null, events: [], questions: [] });
  mountPlanRoutes(
    app,
    plans,
    artifacts,
    { saveStoredValues: async () => {} },
    conversation,
    checks,
  );
  const act = (plugin: string, action: string, input: unknown) =>
    app.request(`/project-1/plugins/${plugin}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
  return { added, act };
}

test("a screen is listed, with its state, only while its state returns one", async () => {
  const catalog = await loadCatalog(
    [
      ...(await readPluginFolder(PLUGINS_FOLDER)),
      ...(await readPluginFolder(join(import.meta.dir, "../plugins/fixtures"))),
    ],
    HOST,
  );
  const shown = (stored: Record<string, unknown>) =>
    shownScreens(
      catalog,
      projectRead(
        catalog,
        { styles: undefined, stored, materials: [] },
        new Set(),
        [],
      ),
    );
  expect(
    catalog.actions.some(
      ({ plugin, action }) => plugin === "tester" && action === "notes",
    ),
  ).toBe(false);
  expect(shown({})).toEqual([]);
  expect(shown({ "tester.notes": "Try the save button" })).toEqual([
    {
      plugin: "tester",
      action: "notes",
      render: "plugin-bar",
      state: { notes: "Try the save button" },
    },
  ]);
});

test("the route refuses an action whose requires do not hold, and adds it to the plan once they do", async () => {
  const change = {
    instruction: "Make the save button on the contact page save the form.",
  };
  const refused = hub({ artifacts: [] });
  const response = await refused.act("coder", "change", change);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "action_requirement_unmet" });
  expect(refused.added).toEqual([]);
  const ready = hub({ artifacts: [{ kind: "app", version: 1 }] });
  expect((await ready.act("coder", "change", change)).status).toBe(200);
  expect(ready.added).toMatchObject([{ plugin: "coder", action: "change" }]);
});
