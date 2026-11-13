import { expect, test } from "bun:test";
import { type } from "arktype";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import { CATALOG } from "../plugins/catalog.ts";
import { createArtifactTools, createWriterArtifactTools } from "./tools.ts";

const writer = CATALOG.role("writer");
if (!writer) throw new Error("writer_role_missing");

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

// The fields each writer's save takes.
const WRITER_FIELDS: Record<WriterDocumentKind, string[]> = {
  product_requirements: ["content", "kind", "openQuestions", "title"],
  build_plan: ["content", "kind", "openQuestions", "title"],
};
const DOC = "## In short\n\n- **Three apps** serve our area.";
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

function harness(role: string, tools: ReturnType<typeof createArtifactTools>) {
  const written: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path === "/api/workflow-project-scope")
      return Response.json({
        tenantId: "tenant",
        projectId: "sb-project1",
        domain: "example.invalid",
        role,
        workflows: {
          "writer-product-requirements": deployment,
          "writer-build-plan": deployment,
          "writer-document": deployment,
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

test("every role's artifact tool definitions declare top-level type: object", () => {
  const tools = [
    ...CATALOG.roles.map((role) =>
      harness(role.name, createArtifactTools(role)),
    ),
    ...WRITER_KINDS.map((kind) =>
      harness(writer.name, createWriterArtifactTools(writer, kind)),
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
      writer.name,
      createWriterArtifactTools(writer, WriterDocumentKind.assert(kind)),
    );
    const [definition] = tools.definitions;
    const schema = FlatToolSchema.assert(definition?.inputSchema);
    expect(Object.keys(schema.properties).sort()).toEqual(fields);
  }
});

test("a writer files under the kind it was deployed for, with or without naming it", async () => {
  for (const kind of WRITER_KINDS) {
    const filing = harness(
      writer.name,
      createWriterArtifactTools(writer, kind),
    );
    const otherKind = await filing.write({
      kind: WRITER_KINDS.find((other) => other !== kind),
      title: "Doc",
      content: DOC,
    });
    expect(otherKind.content).toStartWith("invalid_arguments:");
    const empty = await filing.write({ title: "Doc", content: "" });
    expect(empty.content).toStartWith("invalid_arguments:");
    expect(filing.written).toHaveLength(0);

    await filing.write({ title: "Unnamed", content: DOC });
    await filing.write({ kind, title: "Named", content: DOC });
    expect(filing.written).toEqual([
      { kind, title: "Unnamed", content: DOC },
      { kind, title: "Named", content: DOC },
    ]);
  }
});

test("a document of any kind is filed only with a summary, and the writer is told how to add one", async () => {
  const filing = harness(writer.name, createArtifactTools(writer));
  const bare = await filing.write({
    kind: "user_manual",
    title: "Tonight user manual",
    content: "## Getting started\n\nOpen the app.",
  });
  expect(bare.isError).toBe(true);
  expect(bare.content).toContain("## In short");
  expect(filing.written).toHaveLength(0);

  const summarised = {
    kind: "user_manual",
    title: "Tonight user manual",
    content: `${DOC}\n\n## Getting started\n\nOpen the app.`,
  };
  await filing.write(summarised);
  expect(filing.written).toEqual([summarised]);
});
