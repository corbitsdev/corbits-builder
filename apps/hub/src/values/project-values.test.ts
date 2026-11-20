import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { ProjectError } from "../projects/errors.ts";
import { setThemeTokens } from "../artifacts/design-tweaks.ts";
import type { createArtifactService } from "../artifacts/service.ts";
import { type } from "arktype";
import { defineValue, type Value } from "@corbits-builder/plugin";
import { projectValueWrites } from "./project-values.ts";
import { mountValueRoutes } from "./routes.ts";

const STARTER = new URL(
  "../../../../plugins/designer/starter/.builder/designs/styles.css",
  import.meta.url,
);

function harness(
  filed: string | undefined,
  saved: Record<string, string>[] = [],
  stored: Record<string, unknown>[] = [],
) {
  let styles = filed;
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
  mountValueRoutes(
    app,
    {
      saveRunValues: async () => {},
      saveStoredValues: async (_actor, _project, values) => {
        stored.push(values);
      },
    },
    service,
  );
  return app;
}

const fonts = "keys=look.font-primary,look.font-secondary";

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
  const refused = (await response.json()) as {
    code: string;
    issues: { path: string; message: string }[];
  };
  expect(refused.code).toBe("run_value_not_written");
  const [issue] = refused.issues;
  expect(issue?.path).toBe("stack_language");
  expect(issue?.message).toContain("did you mean `stack.language`?");
  expect(issue?.message).toContain("`stack.starter`");
});

test("saving a value its schema refuses is refused", async () => {
  const response = await save(harness(undefined), { "look.font-primary": "" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "invalid_project_value",
    key: "look.font-primary",
  });
});

test("saving null clears a value whatever its type refuses, but not a filed design's token", async () => {
  const stored: Record<string, unknown>[] = [];
  const cleared = await save(harness(undefined, [], stored), {
    "cloudflare.terms": null,
  });
  expect(cleared.status).toBe(200);
  expect(stored).toEqual([{ "cloudflare.terms": null }]);

  const styled = await save(harness(await Bun.file(STARTER).text()), {
    "look.font-primary": null,
  });
  expect(styled.status).toBe(400);
  expect(await styled.json()).toMatchObject({
    code: "invalid_project_value",
    key: "look.font-primary",
  });
});

test("a json value is saved as the object it is given, and a text value refuses one", () => {
  const declared = new Map<string, Value>([
    [
      "hoster.choice",
      defineValue("hoster.choice", type("unknown"), "The machine to rent"),
    ],
    [
      "hoster.region",
      defineValue("hoster.region", type("string"), "Where it runs"),
    ],
  ]);
  const state = { styles: undefined, stored: {}, materials: [] };
  expect(
    projectValueWrites(
      {
        "hoster.choice": { size: "small", region: "ams" },
        "hoster.region": "ams",
      },
      state,
      declared,
    ),
  ).toEqual({
    tokens: {},
    stored: {
      "hoster.choice": { size: "small", region: "ams" },
      "hoster.region": "ams",
    },
  });
  expect(() =>
    projectValueWrites({ "hoster.region": { region: "ams" } }, state, declared),
  ).toThrow("invalid_project_value");
});
