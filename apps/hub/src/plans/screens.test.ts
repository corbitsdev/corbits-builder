import { expect, test } from "bun:test";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { defineScreen, defineTask } from "@corbits-builder/plugin";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPluginFolder,
  type Found,
} from "@corbits-builder/plugin-host/folder";
import type { StoredPlanStep } from "@corbits-builder/schemas/project";
import { type } from "arktype";
import type { createArtifactService } from "../artifacts/service.ts";
import { HOST, PLUGINS_FOLDER } from "../plugins/catalog.ts";
import type { Checks } from "../plugins/checks.ts";
import { projectRead, runTask, shownScreens } from "../plugins/screens.ts";
import { ProjectError } from "../projects/errors.ts";
import { mountPlanRoutes } from "./routes.ts";
import type { createPlanService } from "./service.ts";

const installed = await readPluginFolder(PLUGINS_FOLDER);
const fixtures = await readPluginFolder(
  join(import.meta.dir, "../plugins/fixtures"),
);
const catalog = await loadCatalog([...installed, ...fixtures], HOST);

// The tester fixture with one of its definitions replaced.
function tester(path: string, definition: unknown): Found {
  const found = fixtures.find(({ folder }) => folder === "tester");
  if (!found) throw new Error("the tester fixture is missing");
  return {
    folder: found.folder,
    manifest: found.manifest,
    has: found.has,
    text: found.text,
    files: found.files,
    module: async (each) => (each === path ? definition : found.module(each)),
  };
}

// A signed-in person on the tenant.
const signedIn: MiddlewareHandler<TenantEnv> = async (c, next) => {
  const at = new Date();
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
};

const empty = { styles: undefined, stored: {}, materials: [] };

// The plan routes on the real plugins, with the project's records and writes held in memory.
function hub(project: {
  artifacts: { kind: string; version: number }[];
  steps?: StoredPlanStep[];
  runs?: unknown[];
}) {
  const added: { step: unknown; goAhead: readonly string[] | undefined }[] = [];
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code }, error.status);
    throw error;
  });
  app.use("*", signedIn);
  const artifacts = {
    projectState: async () => empty,
    list: async () => ({ artifacts: project.artifacts, preferences: {} }),
    stepRuns: async () => project.runs ?? [],
  } as unknown as ReturnType<typeof createArtifactService>;
  const plans = {
    authorizeAction: async () => {},
    projectPlan: async () => ({ steps: project.steps ?? [], updatedAt: null }),
    addPlanStep: async (
      _actor: unknown,
      _project: unknown,
      step: unknown,
      told: { goAhead: readonly string[] | undefined },
    ) => {
      added.push({ step, goAhead: told.goAhead });
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

test("a screen is listed, with its state, only while its state returns one, and one that throws is left out", async () => {
  const shown = (on: typeof catalog, stored: Record<string, unknown>) =>
    shownScreens(
      on,
      projectRead(
        on,
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
  expect(shown(catalog, {})).toEqual([]);
  expect(shown(catalog, { "tester.notes": "Try the save button" })).toEqual([
    {
      plugin: "tester",
      action: "notes",
      render: "plugin-bar",
      state: { notes: "Try the save button" },
    },
  ]);
  const failing = await loadCatalog(
    [
      ...installed,
      tester(
        "./src/notes/definition.ts",
        defineScreen({
          render: "plugin-bar",
          state: () => {
            throw new Error("the notes screen broke");
          },
          input: type({ "+": "reject" }),
          output: type({ "+": "reject" }),
          describe: {
            summary: "Shows nothing.",
            when: "Never.",
            unless: "Always.",
            fields: {},
          },
        }),
      ),
    ],
    HOST,
  );
  expect(shown(failing, { "tester.notes": "Try the save button" })).toEqual([]);
});

test("the route refuses an action whose requires do not hold, adds it once they do, and gives the go-ahead to the same step not yet begun or finished", async () => {
  const change = {
    instruction: "Make the save button on the contact page save the form.",
  };
  const refused = hub({ artifacts: [] });
  const response = await refused.act("coder", "change", change);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "action_requirement_unmet" });
  expect(refused.added).toEqual([]);
  const app = [{ kind: "app", version: 1 }];
  const ready = hub({ artifacts: app });
  expect((await ready.act("coder", "change", change)).status).toBe(200);
  expect(ready.added).toMatchObject([
    { step: { plugin: "coder", action: "change" }, goAhead: undefined },
  ]);
  const step = (id: string, instruction: string) => ({
    id,
    title: "Change the app",
    plugin: "coder",
    action: "change",
    input: { instruction },
    askFirst: true,
  });
  const planned = hub({
    artifacts: app,
    steps: [
      step("other", "Make the footer show the year it is now."),
      step("same", change.instruction),
    ],
  });
  expect((await planned.act("coder", "change", change)).status).toBe(200);
  expect(planned.added).toMatchObject([{ goAhead: ["same"] }]);
  const finished = hub({
    artifacts: app,
    steps: [step("same", change.instruction)],
    runs: [
      {
        runId: "run-1",
        plugin: "coder",
        action: "change",
        step: "same",
        status: "completed",
        startedAt: "2026-11-18T10:00:00.000Z",
        endedAt: "2026-11-18T10:05:00.000Z",
      },
    ],
  });
  expect((await finished.act("coder", "change", change)).status).toBe(200);
  expect(finished.added).toMatchObject([{ goAhead: ["same"] }]);
});

test("a task saves the values it returns, and may write only its own plugin's values kept in the project's store", async () => {
  const task = catalog.tasks.find(
    ({ plugin, action }) => plugin === "tester" && action === "note",
  );
  if (!task) throw new Error("the tester note task is not installed");
  const saved: Record<string, unknown>[] = [];
  const app = new Hono<TenantEnv>();
  app.use("*", signedIn);
  app.post("/", async (c) =>
    c.json({
      note: await runTask(
        c,
        "project-1",
        catalog,
        {
          task,
          read: projectRead(catalog, empty, new Set(), []),
          input: { text: "the contact form" },
        },
        {
          artifacts: {
            projectState: async () => empty,
            saveStyleTokens: async () => {
              throw new Error("a task saved a design token");
            },
          },
          values: {
            saveStoredValues: async (_actor, _project, values) => {
              saved.push(values);
            },
          },
        },
      ),
    }),
  );
  const response = await app.request("/", { method: "POST" });
  expect(await response.json()).toEqual({
    note: "Look into: the contact form",
  });
  expect(saved).toEqual([{ "tester.notes": "the contact form" }]);

  const writing = (writes: string[]) =>
    loadCatalog(
      [
        ...installed,
        tester(
          "./src/note/definition.ts",
          defineTask({
            says: "The person left the tester a note.",
            input: type({ "+": "reject" }),
            describe: { fields: {} },
            writes,
            run: () => ({ saves: [], note: "" }),
          }),
        ),
      ],
      HOST,
    );
  await expect(writing(["brand.guidelines"])).rejects.toThrow(
    "tester note writes brand.guidelines, which tester does not declare",
  );
});
