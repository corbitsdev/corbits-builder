import { expect, test } from "bun:test";
import { type } from "arktype";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import {
  ArtifactKindWrite,
  DesignBundle,
  DesignTweaks,
} from "@corbits-builder/schemas/artifact";
import { ProjectExportMaterial } from "@corbits-builder/schemas/project";
import { mountArtifactRoutes } from "../artifacts/routes.ts";
import { createArtifactService } from "../artifacts/service.ts";
import { createArtifactTools } from "../artifacts/tools.ts";
import { ProjectError, typeIssues } from "./errors.ts";

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  pin: "@corbits-builder/writer@1.0.0",
  entry: "entry",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};

const approach = (id: string) => ({
  id,
  name: `Approach ${id}`,
  summary: "A way to build it.",
  bestFor: "Trying it out.",
  pros: ["Quick"],
  cons: ["Limited"],
  effort: "low",
  risks: [],
});

test("a rejected write_artifact call reaches the agent with {path, message} issues", async () => {
  const service = createArtifactService(
    Object.create(PostgresJsDatabase.prototype),
    {} as never,
  );
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code, ...error.details }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("tenant", { id: "tenant" } as never);
    c.set("principal", { id: "principal" } as never);
    await next();
  });
  const projects = new Hono<TenantEnv>();
  mountArtifactRoutes(projects, service);
  app.route("/api/tenants/:tenantId/projects", projects);
  app.get("/api/workflow-project-scope", (c) =>
    c.json({
      tenantId: "tenant",
      projectId: "p-00000000000000000000000000000000",
      domain: "example.invalid",
      role: "writer",
      workflows: {
        writer: deployment,
        reviewer: deployment,
        coder: deployment,
        designer: deployment,
      },
      openNetwork: false,
      build: {
        assetDirectory: "/a",
        browserCli: "/b",
        childPath: "/c",
        dependencyRoots: ["/d"],
        ripgrepPath: "/r",
        runtimeVersion: "1",
      },
    }),
  );
  const tools = createArtifactTools("writer")({
    capabilities: {
      resolve: () => ({
        resolve: async () => ({
          kind: "http",
          fetch: (path: string, init?: RequestInit) =>
            app.fetch(new Request("http://hub.local" + path, init)),
        }),
      }),
    },
  } as never);
  const write = async (args: Record<string, unknown>) => {
    const result = await tools.run(
      {
        id: "call",
        name: "write_artifact",
        arguments: { title: "Doc", content: "# Doc\n\nBody.", ...args },
      },
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    return JSON.parse(String(result.content));
  };

  expect(
    await write({
      kind: "problem_brief",
      approaches: { approaches: [approach("a"), approach("b")] },
    }),
  ).toEqual({
    code: "invalid_artifact_write",
    status: 400,
    issues: [
      {
        path: "approaches",
        message:
          "goes on the approaches document; write this problem_brief without it",
      },
    ],
  });
  expect(
    await write({
      kind: "approaches",
      approaches: { approaches: [approach("a"), approach("a")] },
    }),
  ).toEqual({
    code: "invalid_artifact_write",
    status: 400,
    issues: [
      {
        path: "approaches.approaches",
        message: "give each approach a unique id",
      },
    ],
  });
  expect(
    await write({
      kind: "approaches",
      approaches: {
        approaches: [approach("a"), approach("b")],
        recommended: "c",
      },
    }),
  ).toEqual({
    code: "invalid_artifact_write",
    status: 400,
    issues: [
      {
        path: "approaches.recommended",
        message: "name one of the approach ids",
      },
    ],
  });
});

test("typeIssues names the rule for narrow checks, unions and extra keys without quoting submitted values", () => {
  const secret = "sk-live-secret-value-not-for-issues";
  const bundle = DesignBundle({ files: { "notes.txt": secret } });
  const tweaks = DesignTweaks({ tokens: {} });
  const write = ArtifactKindWrite({
    kind: secret,
    title: "Title",
    content: "Body",
    extra: secret,
  });
  const material = ProjectExportMaterial({
    title: "file",
    content: secret.repeat(8000),
  });
  if (
    !(bundle instanceof type.errors) ||
    !(tweaks instanceof type.errors) ||
    !(write instanceof type.errors) ||
    !(material instanceof type.errors)
  )
    throw new Error("expected validation errors");

  expect(typeIssues(bundle, "content")).toEqual([
    {
      path: "content.files",
      message: "must be a bundle with DESIGN.md and designs/index.html",
    },
  ]);
  expect(typeIssues(tweaks)).toEqual([
    { path: "tokens", message: "must be at least one token" },
  ]);
  expect(typeIssues(write)).toEqual([
    {
      path: "kind",
      message:
        'must be "app", "approaches", "build_plan", "constraints", "design", "design_option", "problem_brief" or "product_requirements"',
    },
    { path: "extra", message: "is not allowed here" },
  ]);
  expect(typeIssues(material)).toEqual([
    { path: "content", message: "is not one of the allowed values" },
  ]);
  expect(
    JSON.stringify([
      typeIssues(bundle, "content"),
      typeIssues(tweaks),
      typeIssues(write),
      typeIssues(material),
    ]),
  ).not.toContain(secret);
});
