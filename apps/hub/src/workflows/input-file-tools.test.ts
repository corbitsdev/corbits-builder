import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INPUTS_DIRECTORY } from "@corbits-builder/schemas/app-files";
import { assignmentToWriterMessage } from "./writer-task.ts";
import { createInputFileTools, inputFileName } from "./input-file-tools.ts";

test("writer inputs are placed once, confined to their folder, and saved results remain readable", async () => {
  const workdir = await mkdtemp(join(process.cwd(), ".writer-input-test-"));
  try {
    let fetches = 0;
    const tools = createInputFileTools("writer", async () => {
      fetches++;
      return [
        {
          artifactId: "brief",
          title: "Brief",
          kind: "problem_brief",
          content: "The source document",
        },
      ];
    })({
      workdir,
      storage: {
        readBlob: async (key: string) =>
          new TextEncoder().encode(`blob ${key}`),
      },
    } as never);
    const read = (path: string) =>
      tools.run(
        { id: "c", name: "read_file", arguments: { path } },
        new AbortController().signal,
      );
    const path = INPUTS_DIRECTORY + "/problem_brief.md";
    expect((await read(path)).content).toContain("The source document");
    expect((await read(path)).content).toContain("The source document");
    expect(fetches).toBe(1);
    const search = await tools.run(
      {
        id: "s",
        name: "search_files",
        arguments: { pattern: "*.md", path: ".." },
      },
      new AbortController().signal,
    );
    expect(search.content).toBe("problem_brief.md");
    if (typeof search.content !== "string")
      throw new Error("expected search text");
    expect((await read(search.content)).content).toContain(
      "The source document",
    );
    expect(fetches).toBe(1);
    await writeFile(join(workdir, "outside.txt"), "SECRET");
    const refused = await read("outside.txt");
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain(INPUTS_DIRECTORY);
    expect(refused.content).not.toContain("SECRET");
    expect(refused.content).not.toContain(workdir);
    expect((await read("missing.md")).content).toBe(refused.content);
    await symlink(
      join(workdir, "outside.txt"),
      join(workdir, INPUTS_DIRECTORY, "link.md"),
    );
    expect((await read(INPUTS_DIRECTORY + "/link.md")).isError).toBe(true);
    expect((await read("tool-output:///abc")).content).toContain("blob abc");
    expect((await read("tool-output://abc")).content).toContain("blob abc");
  } finally {
    await rm(workdir, { recursive: true });
  }
});

test("writer input preparation reports a failure and retries on the next search", async () => {
  const workdir = await mkdtemp(join(process.cwd(), ".writer-input-test-"));
  try {
    let fetches = 0;
    const tools = createInputFileTools("writer", async () => {
      fetches++;
      if (fetches === 1) throw new Error("Document fetch failed");
      return [
        {
          artifactId: "brief",
          title: "Brief",
          kind: "problem_brief",
          content: "Recovered source",
        },
      ];
    })({
      workdir,
      storage: { readBlob: async () => new Uint8Array() },
    } as never);
    const call = {
      id: "s",
      name: "search_files",
      arguments: { pattern: "*.md" },
    };
    const signal = new AbortController().signal;
    expect(await tools.run(call, signal)).toMatchObject({
      isError: true,
      content: "workflow_project_scope_unavailable",
    });
    expect((await tools.run(call, signal)).content).toBe("problem_brief.md");
    expect(fetches).toBe(2);
  } finally {
    await rm(workdir, { recursive: true });
  }
});

test("colliding material titles keep distinct contents at the assignment paths", async () => {
  const workdir = await mkdtemp(join(process.cwd(), ".writer-input-test-"));
  const documents = [
    {
      artifactId: "first",
      kind: "material",
      title: "notes/a",
      content: "First material",
    },
    {
      artifactId: "second",
      kind: "material",
      title: "notes a",
      content: "Second material",
    },
  ];
  try {
    const tools = createInputFileTools(
      "reviewer",
      async () => documents,
    )({
      workdir,
      storage: { readBlob: async () => new Uint8Array() },
    } as never);
    const ref = (artifactId: string) => ({
      artifactId,
      version: 1,
      sha256: "a".repeat(64),
    });
    const message = JSON.parse(
      assignmentToWriterMessage(
        {
          projectId: "project",
          deliverableId: "review",
          kind: "engineering_review",
          briefRef: ref("first"),
          sourceRefs: [ref("second")],
          output: { expectedVersion: 1 },
          instruction: "Review the materials",
        },
        documents,
      ),
    );
    expect(
      message.documents.map((document: { path: string }) => document.path),
    ).toEqual([
      INPUTS_DIRECTORY + "/notes-a-first.md",
      INPUTS_DIRECTORY + "/notes-a-second.md",
    ]);
    for (const [index, document] of message.documents.entries()) {
      expect(document.content).toBeUndefined();
      const result = await tools.run(
        { id: "read", name: "read_file", arguments: { path: document.path } },
        new AbortController().signal,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain(documents[index]!.content);
    }
  } finally {
    await rm(workdir, { recursive: true });
  }
});

test("material filenames are stable alone and titles are bounded", () => {
  expect(
    inputFileName({ artifactId: "first", kind: "material", title: "notes/a" }),
  ).toBe("notes-a-first.md");
  expect(
    inputFileName({
      artifactId: "id",
      kind: "material",
      title: "x".repeat(200),
    }),
  ).toBe("x".repeat(100) + "-id.md");
});

test("only source document kinds are fetched and the design is readable markdown", async () => {
  const workdir = await mkdtemp(join(process.cwd(), ".writer-input-test-"));
  const fetched: string[] = [];
  const deployment = {
    source: { kind: "asset", assetId: "asset", package: { format: "tarball" } },
    entry: "entry",
    pin: "writer@1.0.0",
    sourceOfferingIds: ["offering"],
    defaultSourceOfferingId: "offering",
  };
  const artifacts = [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
    "build_plan",
    "design",
    "material",
    "app",
    "design_option",
  ].map((kind) => ({
    artifactId: kind,
    kind,
    title: kind,
    version: 1,
    sha256: "a".repeat(64),
    filedAt: "today",
  }));
  const fetch = async (path: string) => {
    if (path === "/api/workflow-project-scope")
      return Response.json({
        tenantId: "tenant",
        projectId: "sb-project1",
        domain: "example.invalid",
        role: "writer",
        workflows: {
          "writer-constraints": deployment,
          "writer-approaches": deployment,
          "writer-product-requirements": deployment,
          "writer-build-plan": deployment,
          reviewer: deployment,
          coder: deployment,
          designer: deployment,
        },
        openNetwork: false,
        build: {
          assetDirectory: "/tmp",
          browserCli: "/tmp/browser",
          childPath: "/tmp/child",
          dependencyRoots: ["/tmp"],
          ripgrepPath: "/tmp/rg",
          runtimeVersion: "1",
        },
      });
    if (path.endsWith("/artifacts"))
      return Response.json({
        artifacts,
        inFlight: [],
        failed: [],
        awaitingApproval: [],
        appBuilt: false,
        preferences: {},
        preferenceGuidance: [],
      });
    const kind = path.slice(path.lastIndexOf("/") + 1);
    fetched.push(kind);
    return Response.json({
      artifactId: kind,
      kind,
      title: kind,
      version: 1,
      sha256: "a".repeat(64),
      filedAt: "today",
      content:
        kind === "design"
          ? JSON.stringify({
              files: {
                "DESIGN.md": "# Design",
                "designs/index.html": "SECRET HTML",
              },
            })
          : "# Source",
      openQuestions: [],
    });
  };
  try {
    const tools = createInputFileTools("writer")({
      workdir,
      storage: { readBlob: async () => new Uint8Array() },
      capabilities: {
        resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
      },
    } as never);
    const result = await tools.run(
      { id: "r", name: "read_file", arguments: { path: "design.md" } },
      new AbortController().signal,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("# Design");
    expect(result.content).toContain("Screens: designs/index.html");
    expect(result.content).not.toContain("SECRET HTML");
    expect(fetched.sort()).toEqual(
      artifacts
        .slice(0, 7)
        .map((item) => item.kind)
        .sort(),
    );
  } finally {
    await rm(workdir, { recursive: true });
  }
});
