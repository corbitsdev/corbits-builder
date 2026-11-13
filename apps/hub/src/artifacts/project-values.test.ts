import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { ProjectError } from "../projects/errors.ts";
import { setThemeTokens } from "./design-tweaks.ts";
import { mountArtifactRoutes } from "./routes.ts";
import type { createArtifactService } from "./service.ts";

const STARTER = new URL(
  "../../../../plugins/designer/starter/.builder/designs/styles.css",
  import.meta.url,
);

function harness(
  stored: string | undefined,
  saved: Record<string, string>[] = [],
) {
  let styles = stored;
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code, ...error.details }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("tenant", { id: "tenant-1" } as TenantEnv["Variables"]["tenant"]);
    c.set("principal", {
      id: "principal-1",
    } as TenantEnv["Variables"]["principal"]);
    await next();
  });
  const service = {
    projectState: async () => ({ styles, stored: {} }),
    valuesRun: async () => ({ plugin: "coder", action: "build" }),
    saveRunValues: async () => {},
    // Stands in for the filed design's next version.
    saveStyleTokens: async (
      _actor: unknown,
      _project: string,
      tokens: Record<string, string>,
    ) => {
      saved.push(tokens);
      styles = setThemeTokens(styles ?? "", tokens);
    },
  } as unknown as ReturnType<typeof createArtifactService>;
  mountArtifactRoutes(app, service);
  return app;
}

const fonts = "keys=look.font-primary,look.font-secondary";

test("the project's fonts are read from the filed design's stylesheet", async () => {
  const app = harness(await Bun.file(STARTER).text());
  const response = await app.request(`/project-1/values?${fonts}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    values: {
      "look.font-primary": "Red Hat Display",
      "look.font-secondary": "Space Mono",
    },
  });
});

test("a project with no filed design has no fonts yet", async () => {
  const response = await harness(undefined).request(
    `/project-1/values?${fonts}`,
  );
  expect(await response.json()).toEqual({
    values: { "look.font-primary": null, "look.font-secondary": null },
  });
});

test("a value that is not registered is refused", async () => {
  const response = await harness(undefined).request(
    "/project-1/values?keys=look.font-primary,look.font-heading",
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "unknown_project_value",
    key: "look.font-heading",
  });
});

const save = (app: ReturnType<typeof harness>, values: unknown) =>
  app.request("/project-1/values", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });

test("saving the primary font leads --font-sans with the stored fallbacks kept", async () => {
  const saved: Record<string, string>[] = [];
  const app = harness(await Bun.file(STARTER).text(), saved);
  const response = await save(app, { "look.font-primary": "Inter" });
  expect(response.status).toBe(200);
  expect(saved).toEqual([
    { "font-sans": '"Inter", "Open Sans", Roboto, Arial, sans-serif' },
  ]);
  expect(await response.json()).toEqual({
    values: { "look.font-primary": "Inter" },
  });
  const state = await (await app.request(`/project-1/values?${fonts}`)).json();
  expect(state).toEqual({
    values: {
      "look.font-primary": "Inter",
      "look.font-secondary": "Space Mono",
    },
  });
});

test("saving a value that is not registered is refused", async () => {
  const response = await save(harness(undefined), {
    "look.font-heading": "Inter",
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "unknown_project_value",
    key: "look.font-heading",
  });
});

test("a run's misspelt value is refused with the names its action saves", async () => {
  const response = await harness(undefined).request("/project-1/run-values", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: { stack_language: "TypeScript" } }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    code: "run_value_not_written",
    issues: [
      {
        path: "stack_language",
        message:
          "is not a value coder build saves; did you mean `stack.language`? It saves only `stack.language`, `stack.checks`, `stack.run`.",
      },
    ],
  });
});

test("saving a value its schema refuses is refused", async () => {
  const response = await save(harness(undefined), { "look.font-primary": "" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "invalid_project_value",
    key: "look.font-primary",
  });
});
