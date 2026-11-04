import { expect, test } from "bun:test";
import { type } from "arktype";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { createArtifactTools, createWriterArtifactTools } from "./tools.ts";

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "entry",
  pin: "@corbits-builder/writer-native@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};

const sampleApproaches = {
  approaches: [
    {
      id: "simple",
      name: "Simple",
      summary: "Client-side forecast view.",
      bestFor: "Fast launch",
      pros: ["Fast to build"],
      cons: ["No server cache"],
      effort: "low" as const,
      risks: ["Rate limits"],
    },
    {
      id: "cached",
      name: "Cached",
      summary: "Server-cached forecast view.",
      bestFor: "Higher traffic",
      pros: ["Fewer upstream calls"],
      cons: ["More moving parts"],
      effort: "medium" as const,
      risks: ["Stale cache"],
    },
  ],
  recommended: "simple",
};

// The fields each writer's save takes.
const WRITER_FIELDS: Record<WriterDocumentKind, string[]> = {
  constraints: ["content", "openQuestions", "title"],
  approaches: ["approaches", "content", "openQuestions", "title"],
  product_requirements: ["content", "openQuestions", "title"],
  build_plan: ["content", "openQuestions", "title"],
};
const WRITER_KINDS = Object.keys(WRITER_FIELDS).map((kind) =>
  WriterDocumentKind.assert(kind),
);
// A provider that reads only top-level properties sees nothing to fill in a union and sends {}.
const FlatToolSchema = type({
  type: "'object'",
  additionalProperties: "false",
  properties: "Record<string, object>",
  "anyOf?": "never",
});

function harness(
  role: WorkflowRole,
  tools: ReturnType<typeof createArtifactTools>,
) {
  const written: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path === "/api/workflow-project-scope")
      return Response.json({
        tenantId: "tenant",
        projectId: "sb-project1",
        domain: "example.invalid",
        role,
        workflows: {
          writers: {
            constraints: deployment,
            approaches: deployment,
            product_requirements: deployment,
            build_plan: deployment,
          },
          reviewer: deployment,
          coder: deployment,
          designer: deployment,
        },
        openNetwork: false,
        build: {
          assetDirectory: "/tmp",
          browserCli: "/tmp/browser",
          childPath: "/tmp/child.ts",
          dependencyRoots: ["/tmp"],
          ripgrepPath: "/tmp/rg",
          runtimeVersion: "1.0.0",
        },
      });
    if (path.endsWith("/artifacts") && init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { kind: string };
      written.push(body);
      return Response.json({
        artifact: {
          artifactId: "art-" + body.kind,
          kind: body.kind,
          version: written.length,
          sha256: "a".repeat(64),
        },
      });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
  } as unknown as RuntimeCapabilities;
  const instance = tools({ capabilities } as never);
  return {
    definitions: instance.definitions,
    written,
    write: (args: Record<string, unknown>) =>
      instance.run(
        { id: "call", name: "write_artifact", arguments: args },
        new AbortController().signal,
      ),
  };
}

test("coordinator write_artifact exposes only problem_brief without approaches", async () => {
  const coordinator = harness(
    "coordinator",
    createArtifactTools("coordinator"),
  );
  const definition = coordinator.definitions.find(
    (item) => item.name === "write_artifact",
  );
  expect(definition).toBeDefined();
  expect(definition?.description).not.toContain("approaches");
  const properties = (
    definition?.inputSchema as
      | { properties?: Record<string, unknown> }
      | undefined
  )?.properties;
  expect(properties?.["kind"]).toEqual({ const: "problem_brief" });
  expect(properties?.["approaches"]).toBeUndefined();

  const withApproaches = await coordinator.write({
    kind: "problem_brief",
    title: "Problem Brief",
    content: "# Problem Brief\n\nWeather at a glance.",
    approaches: sampleApproaches,
  });
  expect(withApproaches.isError).toBe(true);
  expect(withApproaches.content).toContain("approaches");

  const wrongKind = await coordinator.write({
    kind: "constraints",
    title: "Constraints",
    content: "# Constraints",
  });
  expect(wrongKind.isError).toBe(true);
  expect(wrongKind.content).toBe(
    "brief_only: you write the problem brief; deploy_writer has a writer write the constraints",
  );

  const valid = await coordinator.write({
    kind: "problem_brief",
    title: "Problem Brief",
    content: "# Problem Brief\n\nWeather at a glance.",
  });
  expect(valid.isError).toBeUndefined();
  expect(coordinator.written).toHaveLength(1);
});

test("every role's artifact tool definitions declare top-level type: object", () => {
  const tools = [
    ...(["coordinator", "reviewer", "coder", "designer"] as const).map((role) =>
      harness(role, createArtifactTools(role)),
    ),
    ...WRITER_KINDS.map((kind) =>
      harness("writer", createWriterArtifactTools(kind)),
    ),
  ];
  for (const tool of tools) {
    for (const definition of tool.definitions) {
      expect(
        (definition.inputSchema as { type?: unknown } | undefined)?.type,
      ).toBe("object");
    }
  }
});

test("each writer's write_artifact lists only its own fields, at the top level", () => {
  for (const [kind, fields] of Object.entries(WRITER_FIELDS)) {
    const tools = harness(
      "writer",
      createWriterArtifactTools(WriterDocumentKind.assert(kind)),
    );
    const [definition] = tools.definitions;
    const schema = FlatToolSchema.assert(definition?.inputSchema);
    expect(Object.keys(schema.properties).sort()).toEqual(fields);
  }
});

test("a writer saves without a kind and files under the kind it was deployed for", async () => {
  const constraints = harness(
    "writer",
    createWriterArtifactTools("constraints"),
  );
  const named = await constraints.write({
    kind: "build_plan",
    title: "Build Plan",
    content: "# Build Plan",
  });
  expect(named.isError).toBe(true);
  expect(named.content).toStartWith("invalid_arguments:");
  const withApproaches = await constraints.write({
    title: "Constraints",
    content: "# Constraints",
    approaches: sampleApproaches,
  });
  expect(withApproaches.isError).toBe(true);
  expect(withApproaches.content).toContain("approaches");
  expect(
    (await constraints.write({ title: "Constraints", content: "" })).isError,
  ).toBe(true);
  expect(constraints.written).toHaveLength(0);

  const saved = await constraints.write({
    title: "Constraints",
    content: "# Constraints",
  });
  expect(saved.isError).toBeUndefined();
  expect(constraints.written).toEqual([
    { kind: "constraints", title: "Constraints", content: "# Constraints" },
  ]);

  const approaches = harness("writer", createWriterArtifactTools("approaches"));
  const valid = await approaches.write({
    title: "Approaches",
    content: "# Approaches",
    approaches: sampleApproaches,
  });
  expect(valid.isError).toBeUndefined();
  expect(approaches.written).toEqual([
    {
      kind: "approaches",
      title: "Approaches",
      content: "# Approaches",
      approaches: sampleApproaches,
    },
  ]);
});
