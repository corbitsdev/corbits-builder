import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { PlanView } from "@corbits-builder/schemas/project";
import type { createArtifactService } from "../artifacts/service.ts";
import type { Checks } from "../plugins/checks.ts";
import { ProjectError } from "../projects/errors.ts";
import { mountPlanRoutes } from "./routes.ts";
import type { createPlanService } from "./service.ts";

// A check's latest record, as the hub keeps it, whose pass makes what it returns true.
const passed = (plugin: string, action: string, returns: string[]) => ({
  checkId: `${plugin}-${action}`,
  plugin,
  action,
  input: {},
  result: "pass" as const,
  summary: "It passed",
  evidence: [],
  versions: {},
  current: true,
  returns,
  triggeredBy: "hub",
  createdAt: "2026-11-18T10:00:00.000Z",
});

// The plan routes on the real plugins, with the project's records and writes held in memory.
function hub(project: {
  artifacts: { kind: string; version: number }[];
  checks?: ReturnType<typeof passed>[];
  stored?: Record<string, unknown>;
  plan?: unknown[];
}) {
  const saved: Record<string, unknown>[] = [];
  const added: unknown[] = [];
  const waiting: (string | undefined)[] = [];
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("tenant", { id: "tenant-1" } as TenantEnv["Variables"]["tenant"]);
    c.set("principal", {
      id: "principal-1",
      kind: "user",
    } as TenantEnv["Variables"]["principal"]);
    await next();
  });
  const artifacts = {
    projectState: async () => ({
      styles: undefined,
      stored: project.stored ?? {},
      materials: [],
    }),
    savedApp: async () => undefined,
    list: async () => ({ artifacts: project.artifacts, preferences: {} }),
    stepRuns: async () => [],
  } as unknown as ReturnType<typeof createArtifactService>;
  const plans = {
    authorizeAction: async () => {},
    projectPlan: async () => ({ steps: project.plan ?? [], updatedAt: null }),
    addPlanStep: async (
      _actor: unknown,
      _project: unknown,
      step: unknown,
      told: { waiting: string | undefined },
    ) => {
      added.push(step);
      waiting.push(told.waiting);
    },
    tellCoordinator: async () => {},
  } as unknown as ReturnType<typeof createPlanService>;
  const checks = {
    latest: async () => project.checks ?? [],
    changed: async () => {},
  } as unknown as Checks;
  const conversation = async () =>
    Response.json({ runId: null, events: [], questions: [] });
  mountPlanRoutes(
    app,
    plans,
    artifacts,
    {
      saveStoredValues: async (_actor, _project, values) => {
        saved.push(values);
      },
    },
    conversation,
    checks,
  );
  const read = async () =>
    PlanView.assert(await (await app.request("/project-1/plan")).json());
  const screens = async () => (await read()).screens;
  const act = (plugin: string, action: string, input: unknown) =>
    app.request(`/project-1/plugins/${plugin}/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
  return { saved, added, waiting, read, screens, act };
}

test("a screen is listed, with its state, only while its state returns one", async () => {
  expect(await hub({ artifacts: [] }).screens()).toEqual([]);
  const [shown] = await hub({
    artifacts: [{ kind: "app", version: 1 }],
  }).screens();
  expect(shown).toMatchObject({
    plugin: "publish",
    action: "published",
    render: "plugin-bar",
    state: { is: "never" },
  });
});

test("a stored step whose action is no longer installed is left out of the plan as read", async () => {
  const step = (id: string, plugin: string, action: string) => ({
    id,
    title: id,
    plugin,
    action,
    input: {},
    askFirst: false,
  });
  const { steps } = await hub({
    artifacts: [],
    plan: [
      step("gone", "publish", "confirm"),
      {
        id: "group",
        title: "Old publish",
        steps: [step("old", "publish", "confirm")],
      },
      step("ready", "server", "ready"),
    ],
  }).read();
  expect(steps.map(({ id }) => id)).toEqual(["ready"]);
});

test("an action saves the values it writes and adds its work to the plan", async () => {
  const project = hub({ artifacts: [{ kind: "app", version: 1 }] });
  const response = await project.act("publish", "publish", {
    plan: "publish-to-server",
  });
  expect(response.status).toBe(200);
  expect(project.saved).toEqual([
    {
      "publish.go-ahead": {
        plan: "publish-to-server",
        at: expect.any(String),
      },
      "publish.plan": "publish-to-server",
      "publish.take-down": null,
    },
  ]);
  expect(project.added).toMatchObject([{ plan: "publish-to-server" }]);
});

test("taking down, keeping and saying it is gone save what each writes, and taking down adds the place's removal", async () => {
  const release = {
    target: "server",
    url: "http://203.0.113.7/",
    version: "abc123",
    at: "2026-11-18T10:00:00.000Z",
  };
  const project = hub({
    artifacts: [{ kind: "app", version: 1 }],
    stored: {
      "publish.release": release,
      "publish.keep": {
        link: "https://example.com/keep",
        until: "2026-11-18T11:00:00.000Z",
        place: "Example Host",
      },
    },
  });
  for (const action of ["take-down", "kept", "gone"])
    expect((await project.act("publish", action, {})).status).toBe(200);
  expect(project.saved).toEqual([
    {
      "publish.take-down": { target: "server", release: release.at },
      "publish.go-ahead": null,
    },
    { "publish.keep": null },
    {
      "publish.release": null,
      "publish.holding": null,
      "publish.keep": null,
    },
  ]);
  expect(project.added).toMatchObject([{ plugin: "server", action: "remove" }]);
});

test("the hub refuses a publish the person has not given their go-ahead to, and gives it to the same publish not yet begun", async () => {
  const publish = {
    instruction: "Publish the saved app to the person's own server.",
  };
  const ready = [passed("server", "ready", ["ready:server"])];
  const refused = hub({
    artifacts: [{ kind: "app", version: 1 }],
    checks: ready,
  });
  expect((await refused.act("server", "publish", publish)).status).toBe(409);
  expect(refused.added).toEqual([]);
  const agreed = hub({
    artifacts: [{ kind: "app", version: 1 }],
    checks: [...ready, passed("publish", "agreed", ["agreed:publish"])],
  });
  expect((await agreed.act("server", "publish", publish)).status).toBe(200);
  expect(agreed.added).toMatchObject([{ plugin: "server", action: "publish" }]);
  expect(agreed.waiting).toEqual([undefined]);
  const step = (id: string, instruction: string) => ({
    id,
    title: "Publish the app",
    plugin: "server",
    action: "publish",
    input: { instruction },
    askFirst: true,
  });
  const planned = hub({
    artifacts: [{ kind: "app", version: 1 }],
    checks: [...ready, passed("publish", "agreed", ["agreed:publish"])],
    plan: [
      step("other", "Publish the saved app somewhere else."),
      step("same", publish.instruction),
    ],
  });
  expect((await planned.act("server", "publish", publish)).status).toBe(200);
  expect(planned.waiting).toEqual(["same"]);
});
