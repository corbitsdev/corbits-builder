import { expect, test } from "bun:test";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { createArtifactTools } from "./tools.ts";

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

function harness(role: WorkflowRole) {
  const written: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path === "/api/workflow-project-scope")
      return Response.json({
        tenantId: "tenant",
        projectId: "sb-project1",
        domain: "example.invalid",
        role,
        workflows: {
          writer: deployment,
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
  const instance = createArtifactTools(role)({ capabilities } as never);
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
  const coordinator = harness("coordinator");
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
  const roles: WorkflowRole[] = [
    "coordinator",
    "writer",
    "reviewer",
    "coder",
    "designer",
  ];
  for (const role of roles) {
    for (const definition of harness(role).definitions) {
      expect(
        (definition.inputSchema as { type?: unknown } | undefined)?.type,
      ).toBe("object");
    }
  }
});

test("writer write_artifact exposes only writer kinds and validates approaches", async () => {
  const writer = harness("writer");
  const definition = writer.definitions.find(
    (item) => item.name === "write_artifact",
  );
  const schema = definition?.inputSchema as
    | {
        type?: unknown;
        additionalProperties?: boolean;
        properties?: {
          kind?: { enum?: string[] };
          approaches?: unknown;
          content?: unknown;
          openQuestions?: unknown;
          title?: unknown;
        };
      }
    | undefined;
  expect(schema?.type).toBe("object");
  expect(schema?.additionalProperties).toBe(false);
  expect(schema?.properties?.kind?.enum).toEqual([
    "approaches",
    "build_plan",
    "constraints",
    "product_requirements",
  ]);
  expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
    "approaches",
    "content",
    "kind",
    "openQuestions",
    "title",
  ]);

  const briefAttempt = await writer.write({
    kind: "problem_brief",
    title: "Problem Brief",
    content: "# Problem Brief",
  });
  expect(briefAttempt.isError).toBe(true);
  expect(briefAttempt.content).toStartWith("invalid_arguments:");

  for (const kind of ["constraints", "product_requirements", "build_plan"]) {
    const rejected = await writer.write({
      kind,
      title: "Doc",
      content: "# Doc",
      approaches: sampleApproaches,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toStartWith("invalid_arguments:");
    expect(rejected.content).toContain("approaches");
  }
  expect(writer.written).toHaveLength(0);

  const validApproaches = await writer.write({
    kind: "approaches",
    title: "Approaches",
    content: "# Approaches",
    approaches: sampleApproaches,
  });
  expect(validApproaches.isError).toBeUndefined();
  expect(writer.written).toEqual([
    {
      kind: "approaches",
      title: "Approaches",
      content: "# Approaches",
      approaches: sampleApproaches,
    },
  ]);
});
