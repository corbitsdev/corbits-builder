import { expect, test } from "bun:test";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { createDeployTools } from "@corbits-builder/tools-handoff/sidecar-bundle";
import { handoffConfig } from "./handoff-config.ts";

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "entry",
  pin: "@corbits-builder/coder@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};

type Filed = { version: number; approvedVersion?: number } | undefined;

function coderSpawn(changed: Record<string, Filed>) {
  const deployed: string[] = [];
  const artifacts = [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
    "design",
    "build_plan",
  ].flatMap((kind) => {
    const filed: Filed =
      kind in changed ? changed[kind] : { version: 1, approvedVersion: 1 };
    return filed
      ? [
          {
            kind,
            artifactId: kind,
            title: kind,
            sha256: "a".repeat(64),
            ...filed,
          },
        ]
      : [];
  });
  const fetch = async (path: string, init: RequestInit) => {
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(path);
      return Response.json({
        id: "run-coder",
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({ artifacts, inFlight: [], preferences: {} });
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : { send: async () => undefined },
  } as unknown as RuntimeCapabilities;
  const tools = createDeployTools(handoffConfig, {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows: {
      writer: deployment,
      reviewer: deployment,
      coder: deployment,
      designer: deployment,
    },
    maxResultBytes: 16384,
  });
  return {
    deployed,
    run: () =>
      tools({ capabilities } as never).run(
        { id: "call", name: "deploy_coder", arguments: {} },
        new AbortController().signal,
      ),
  };
}

test("the coder spawns only from the approved current design version", async () => {
  for (const design of [{ version: 2 }, { version: 2, approvedVersion: 1 }]) {
    const spawn = coderSpawn({ design });
    const result = await spawn.run();
    expect(result.isError).toBe(true);
    expect(result.content).toStartWith("design_not_approved:");
    expect(spawn.deployed).toEqual([]);
  }
  const approved = coderSpawn({ design: { version: 2, approvedVersion: 2 } });
  expect((await approved.run()).isError).toBeUndefined();
  expect(approved.deployed).toHaveLength(1);
});

test("the coder spawns only from the approved current build plan version", async () => {
  for (const [build_plan, refusal] of [
    [undefined, "build_plan_not_filed:"],
    [{ version: 2, approvedVersion: 1 }, "build_plan_not_approved:"],
  ] as const) {
    const spawn = coderSpawn({ build_plan });
    const result = await spawn.run();
    expect(result.isError).toBe(true);
    expect(result.content).toStartWith(refusal);
    expect(spawn.deployed).toEqual([]);
  }
});

test("design_app starts one designer per concept within the person's limit, each named before its assignment", async () => {
  const events: string[] = [];
  const sha = (n: number) => String(n).repeat(64);
  const artifacts = [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
    "build_plan",
  ].map((kind) => ({
    kind,
    artifactId: kind,
    title: kind,
    version: 1,
    sha256: sha(1),
  }));
  let runs = 0;
  const fetch = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/workflows/deployments")) {
      events.push("deploy");
      return Response.json({
        id: "run-" + String(++runs),
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/design-concepts")) {
      events.push("concept " + body.runId + " " + body.concept.label);
      return Response.json(body);
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({
        artifacts,
        inFlight: [],
        preferences: { design_concepts: "two" },
      });
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : {
            send: async (message: { content: string }) => {
              events.push(
                "mail " +
                  (message.content.match(/Design concept: ([^.]+)/)?.[1] ?? ""),
              );
            },
          },
  } as unknown as RuntimeCapabilities;
  const tools = createDeployTools(handoffConfig, {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows: {
      writer: deployment,
      reviewer: deployment,
      coder: deployment,
      designer: deployment,
    },
    maxResultBytes: 16384,
  })({ capabilities } as never);
  const run = (name: string, args: Record<string, unknown>) =>
    tools.run(
      { id: "call", name, arguments: args },
      new AbortController().signal,
    );
  const instruction =
    "Design the dashboard the requirements describe, in the person's words.";
  const lookIdeas = "Calm and readable, like a paper notebook.";
  const concepts = ["Sleek", "Pastel", "Retro"].map((label) => ({
    label,
    direction: label + " look",
  }));

  expect(
    (await run("design_app", { instruction, lookIdeas, concepts })).content,
  ).toStartWith("too_many_concepts:");
  expect(
    (
      await run("design_app", {
        instruction,
        lookIdeas,
        concepts: concepts.slice(0, 2),
      })
    ).isError,
  ).toBe(undefined);
  // Each concept is recorded against its run before the run's assignment fires it.
  for (const [index, label] of ["Sleek", "Pastel"].entries()) {
    const runId = "run-" + String(index + 1);
    expect(events.indexOf("concept " + runId + " " + label)).toBeLessThan(
      events.indexOf("mail " + label),
    );
  }
  expect(events.filter((event) => event === "deploy")).toHaveLength(2);
});

function writerTools(preferences: Record<string, string> = {}) {
  const documents: Record<string, unknown>[] = [
    { kind: "problem_brief", artifactId: "brief", title: "Brief", version: 2 },
    { kind: "constraints", artifactId: "c", title: "C", version: 1 },
  ].map((item) => ({ ...item, sha256: "a".repeat(64) }));
  const deployed: string[] = [];
  const approvals: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(path);
      return Response.json({
        id: "run-writer",
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({ artifacts: documents, inFlight: [], preferences });
    if (path.includes("/artifacts/") && init.method === "GET") {
      const source = documents.find((item) =>
        path.includes("/artifacts/" + item["artifactId"]),
      )!;
      const { approvedVersion: _, ...stored } = source;
      const content =
        source["kind"] === "design"
          ? JSON.stringify({
              files: {
                "DESIGN.md": "# Calm design",
                "designs/index.html": "<main></main>",
              },
            })
          : "content";
      return Response.json({
        ...stored,
        filedAt: new Date(0).toISOString(),
        content,
      });
    }
    if (path.endsWith("/artifact-approvals")) {
      approvals.push(body);
      for (const ref of body.artifacts)
        documents.find((item) => item["kind"] === ref.kind)![
          "approvedVersion"
        ] = ref.version;
      return Response.json({
        approvalId: "approval",
        artifacts: body.artifacts,
      });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : { send: async () => undefined },
  } as unknown as RuntimeCapabilities;
  const tools = createDeployTools(handoffConfig, {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows: {
      writer: deployment,
      reviewer: deployment,
      coder: deployment,
      designer: deployment,
    },
    maxResultBytes: 16384,
  })({ capabilities } as never);
  const run = (name: string, args: Record<string, unknown>) =>
    tools.run(
      { id: "call", name, arguments: args },
      new AbortController().signal,
    );
  return { run, deployed, approvals, documents };
}

const writer = (kind: string) => ({
  kind,
  instruction:
    "Write the " + kind + " from the filed documents and the person's answers.",
});

test("one ask approves several documents, and a writer starts once every earlier one is approved", async () => {
  const { run, deployed, approvals } = writerTools();

  expect(
    (await run("deploy_writer", writer("constraints"))).content,
  ).toStartWith("problem_brief_not_approved:");
  expect(
    (await run("request_approval", { kinds: ["problem_brief", "constraints"] }))
      .isError,
  ).toBeUndefined();
  expect(
    (await run("deploy_writer", writer("product_requirements"))).content,
  ).toStartWith("approaches_missing:");
  expect(deployed).toEqual([]);
  expect(approvals).toEqual([
    {
      tool: "request_approval",
      artifacts: (["problem_brief", "constraints"] as const).map(
        (kind, index) => ({
          kind,
          artifactId: kind === "problem_brief" ? "brief" : "c",
          version: 2 - index,
          sha256: "a".repeat(64),
        }),
      ),
    },
  ]);
  expect(
    (await run("deploy_writer", writer("approaches"))).isError,
  ).toBeUndefined();
  expect(
    (await run("deploy_writer", writer("constraints"))).isError,
  ).toBeUndefined();
  expect(deployed).toHaveLength(2);
});

test("with the agent deciding approvals, a filed earlier document is enough", async () => {
  const { run, deployed, approvals } = writerTools({
    agent_decides_approvals: "yes",
  });

  expect(
    (await run("deploy_writer", writer("product_requirements"))).content,
  ).toStartWith("approaches_missing:");
  expect(
    (await run("deploy_writer", writer("approaches"))).isError,
  ).toBeUndefined();
  expect(deployed).toHaveLength(1);
  expect(approvals).toEqual([]);
});

test("the build plan starts only from the design the person chose", async () => {
  const { run, deployed, documents } = writerTools();
  documents.push(
    ...["approaches", "product_requirements"].map((kind) => ({
      kind,
      artifactId: kind,
      title: kind,
      version: 1,
      sha256: "a".repeat(64),
    })),
  );
  for (const document of documents)
    document["approvedVersion"] = document["version"];

  expect(
    (await run("deploy_writer", writer("build_plan"))).content,
  ).toStartWith("design_missing:");
  const design: Record<string, unknown> = {
    kind: "design",
    artifactId: "design",
    title: "Design",
    version: 2,
    sha256: "b".repeat(64),
    approvedVersion: 1,
  };
  documents.push(design);
  expect(
    (await run("deploy_writer", writer("build_plan"))).content,
  ).toStartWith("design_not_approved:");
  expect(deployed).toEqual([]);
  design["approvedVersion"] = 2;
  expect(
    (await run("deploy_writer", writer("build_plan"))).isError,
  ).toBeUndefined();
  expect(deployed).toHaveLength(1);
});
