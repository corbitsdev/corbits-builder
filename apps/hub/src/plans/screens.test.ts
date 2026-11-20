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

const read = (stored: Record<string, unknown> = {}) => ({
  state: { styles: undefined, stored, materials: [] },
  facts: new Set<string>(),
  steps: [],
  now: Date.parse("2026-11-20T10:00:00.000Z"),
  appVersion: undefined,
  coordinator: { working: false, since: undefined },
  runs: [],
  asking: [],
  manages: true,
});

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
    runs: async () => [],
    coordinatorTurn: async () => ({ working: false, since: undefined }),
    managesProject: async () => true,
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
  const checks = {
    latest: async () => ({ records: [], appVersion: "v3" }),
  } as unknown as Checks;
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
    shownScreens(on, projectRead(on, read(stored)));
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

async function runNote(on: typeof catalog) {
  const task = on.tasks.find(
    ({ plugin, action }) => plugin === "tester" && action === "note",
  );
  if (!task) throw new Error("the tester note task is not installed");
  const saved: Record<string, unknown>[] = [];
  const told: string[] = [];
  const app = new Hono<TenantEnv>();
  app.use("*", signedIn);
  app.post("/", async (c) => {
    await runTask(
      c,
      "project-1",
      on,
      {
        task,
        read: projectRead(on, read()),
        input: { text: "the contact form" },
        teller: async () => async (note) => {
          told.push(note);
        },
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
    );
    return c.body(null, 204);
  });
  expect((await app.request("/", { method: "POST" })).status).toBe(204);
  return { saved, told };
}

test("a task saves the values it returns, tells nothing without a note, and may write only its own plugin's values kept in the project's store", async () => {
  expect(await runNote(catalog)).toEqual({
    saved: [{ "tester.notes": "the contact form" }],
    told: [],
  });

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

test("a task that returns a note tells it once", async () => {
  const telling = await loadCatalog(
    [
      ...installed,
      tester(
        "./src/note/definition.ts",
        defineTask({
          says: "The person left the tester a note.",
          input: type({ "+": "reject", text: "string > 0" }),
          describe: { fields: { text: { about: "What to look into" } } },
          writes: ["tester.notes"],
          run: (_project, { text }) => ({
            saves: [{ name: "tester.notes", value: text }],
            note: `Look into: ${text}`,
          }),
        }),
      ),
    ],
    HOST,
  );
  expect((await runNote(telling)).told).toEqual([
    "Look into: the contact form",
  ]);
});
