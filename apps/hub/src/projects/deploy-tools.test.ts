import { expect, test } from "bun:test";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { CoordinatorMode } from "../environment.ts";
import { createDeployTools } from "./deploy-tools.ts";

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
const writerDeployment = (name: string) => ({
  ...deployment,
  pin: `@corbits-builder/${name}-native@1.0.0`,
});
const workflows = {
  "writer-constraints": writerDeployment("writer-constraints"),
  "writer-approaches": writerDeployment("writer-approaches"),
  "writer-product-requirements": writerDeployment(
    "writer-product-requirements",
  ),
  "writer-build-plan": writerDeployment("writer-build-plan"),
  reviewer: deployment,
  coder: deployment,
  designer: deployment,
};

type Filed = { version: number; approvedVersion?: number } | undefined;

function coderSpawn(
  changed: Record<string, Filed>,
  built = false,
  mode: CoordinatorMode = "classic",
) {
  const deployed: string[] = [];
  const approvals: unknown[] = [];
  const mailed: string[] = [];
  const artifacts = [
    ...new Set([
      "problem_brief",
      "constraints",
      "approaches",
      "product_requirements",
      "design",
      "build_plan",
      ...Object.keys(changed),
    ]),
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
      return Response.json({
        artifacts,
        inFlight: [],
        appBuilt: built,
        preferences: {},
      });
    if (path.endsWith("/artifact-approvals")) {
      approvals.push(JSON.parse(String(init.body)));
      return Response.json({ approvalId: "approval", artifacts: [] });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : {
            send: async (message: { content: string }) => {
              mailed.push(message.content);
            },
          },
  } as unknown as RuntimeCapabilities;
  const tools = createDeployTools(mode, {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  });
  return {
    deployed,
    approvals,
    mailed,
    run: (name = "deploy_coder", args: Record<string, unknown> = {}) =>
      tools({ capabilities } as never).run(
        { id: "call", name, arguments: args },
        new AbortController().signal,
      ),
  };
}

test("the first build is deploy_coder's until a checked version is filed, even with an app filed, and every change after is instruct_coder's", async () => {
  const filedApp = { app: { version: 1 } };
  const change = {
    instruction: "Make the forecast cards larger and easier to read.",
  };
  // A coder that handed back before any passing check leaves the first build to do, and an
  // approved change is no approval of its documents.
  const unbuilt = coderSpawn(filedApp);
  expect((await unbuilt.run("instruct_coder", change)).content).toStartWith(
    "app_not_built:",
  );
  expect(unbuilt.approvals).toEqual([]);
  expect((await unbuilt.run()).isError).toBeUndefined();
  expect(unbuilt.deployed).toHaveLength(1);

  const built = coderSpawn(filedApp, true);
  expect((await built.run()).content).toStartWith("app_already_built:");
  expect((await built.run("instruct_coder", change)).isError).toBeUndefined();
  expect(built.approvals).toHaveLength(1);
  expect(built.deployed).toHaveLength(1);
});

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

const definitionsIn = (mode: CoordinatorMode) =>
  createDeployTools(mode).definitions.filter(
    (definition) => definition.name !== "question",
  );

test("in dynamic mode only instruct_coder stops waiting for the person; every other mark is classic's", () => {
  expect(definitionsIn("dynamic")).toEqual(
    definitionsIn("classic").map((definition) =>
      definition.name === "instruct_coder"
        ? { name: "instruct_coder" }
        : definition,
    ),
  );
  expect(definitionsIn("classic")).toContainEqual({
    name: "instruct_coder",
    approval: "ask",
  });
});

const NO_DOCUMENTS = {
  problem_brief: undefined,
  constraints: undefined,
  approaches: undefined,
  product_requirements: undefined,
  design: undefined,
  build_plan: undefined,
};

test("in dynamic mode instruct_coder changes an imported app with no documents at once, and refuses a project with no app", async () => {
  const change = { instruction: "Change the app's font to Inter everywhere." };
  const imported = coderSpawn(
    { ...NO_DOCUMENTS, app: { version: 1 } },
    false,
    "dynamic",
  );
  expect(
    (await imported.run("instruct_coder", change)).isError,
  ).toBeUndefined();
  expect(imported.deployed).toHaveLength(1);
  expect(imported.approvals).toEqual([]);
  expect(imported.mailed[0]).toContain(change.instruction);

  const empty = coderSpawn(NO_DOCUMENTS, false, "dynamic");
  const refused = await empty.run("instruct_coder", change);
  expect(refused.isError).toBe(true);
  expect(refused.content).toStartWith("app_missing:");
  expect(empty.deployed).toEqual([]);
});

test("in dynamic mode the first build keeps classic's gate", async () => {
  const spawn = coderSpawn(
    { design: { version: 2, approvedVersion: 1 } },
    false,
    "dynamic",
  );
  expect((await spawn.run()).content).toStartWith("design_not_approved:");
  const unapproved = coderSpawn(
    { constraints: { version: 1 } },
    false,
    "dynamic",
  );
  expect((await unapproved.run()).content).toStartWith(
    "constraints_not_approved:",
  );
  expect([...spawn.deployed, ...unapproved.deployed]).toEqual([]);
});

test("design_app starts one designer per concept the person asks for, each named before its assignment", async () => {
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
  let inFlight: Record<string, unknown>[] = [];
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
        inFlight,
        appBuilt: false,
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
  const tools = createDeployTools("classic", {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
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
  const concept = (label: string) => ({ label, direction: label + " look" });
  const concepts = ["Sleek", "Pastel", "Retro"].map(concept);

  // Only the ceiling on concepts at work holds; the person's two is guidance for the coordinator.
  inFlight = ["Calm", "Bold", "Editorial"].map((label, index) => ({
    runId: "live-" + String(index),
    role: "designer",
    status: "running",
    state: "working",
    concept: label,
  }));
  expect(
    (await run("design_app", { instruction, lookIdeas, concepts })).content,
  ).toStartWith("too_many_concepts: at most 5");
  inFlight = [];
  // The person asked for three looks while their preference says two: what they say wins.
  expect(
    (await run("design_app", { instruction, lookIdeas, concepts })).isError,
  ).toBe(undefined);
  // Each concept is recorded against its run before the run's assignment fires it.
  for (const [index, label] of ["Sleek", "Pastel", "Retro"].entries()) {
    const runId = "run-" + String(index + 1);
    expect(events.indexOf("concept " + runId + " " + label)).toBeLessThan(
      events.indexOf("mail " + label),
    );
  }
  expect(events.filter((event) => event === "deploy")).toHaveLength(3);
});

test("a later design pass on a concept never starts while a designer still works on it", async () => {
  const artifacts = [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
  ].map((kind) => ({
    kind,
    artifactId: kind,
    title: kind,
    version: 1,
    sha256: "a".repeat(64),
  }));
  const inFlight = [
    {
      runId: "run-1",
      role: "designer",
      status: "running",
      state: "working",
      concept: "Sleek",
    },
  ];
  const deployed: string[] = [];
  const mailed: string[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(path);
      return Response.json({ code: "unexpected_deploy" }, { status: 500 });
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({
        artifacts,
        inFlight,
        appBuilt: false,
        preferences: {},
      });
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : {
            send: async (message: { content: string }) => {
              mailed.push(message.content);
            },
          },
  } as unknown as RuntimeCapabilities;
  const result = await createDeployTools("classic", {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  })({ capabilities } as never).run(
    {
      id: "call",
      name: "design_app",
      arguments: {
        instruction: "Make the forecast cards larger and easier to read.",
        lookIdeas: "Calm and readable.",
        concepts: [{ label: "Sleek", direction: "Sleek look" }],
      },
    },
    new AbortController().signal,
  );
  const [refused] = JSON.parse(String(result.content)) as { error?: string }[];
  expect(refused?.error).toStartWith("designer_running:");
  expect({ deployed, mailed }).toEqual({ deployed: [], mailed: [] });
});

function writerTools(preferences: Record<string, string> = {}) {
  const documents: Record<string, unknown>[] = [
    { kind: "problem_brief", artifactId: "brief", title: "Brief", version: 2 },
    { kind: "constraints", artifactId: "c", title: "C", version: 1 },
  ].map((item) => ({ ...item, sha256: "a".repeat(64) }));
  const deployed: string[] = [];
  const approvals: unknown[] = [];
  const inFlight: Record<string, unknown>[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(body.pin);
      return Response.json({
        id: "run-writer",
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({
        artifacts: documents,
        inFlight,
        appBuilt: false,
        preferences,
      });
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
  const tools = createDeployTools("classic", {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  })({ capabilities } as never);
  const run = (name: string, args: Record<string, unknown>) =>
    tools.run(
      { id: "call", name, arguments: args },
      new AbortController().signal,
    );
  return { run, deployed, approvals, documents, inFlight };
}

const writer = (kind: string) => ({
  kind,
  instruction:
    "Write the " + kind + " from the filed documents and the person's answers.",
});

test("an approval reports the steps whose gates it opened, unless one is under way", async () => {
  const { run, documents, inFlight } = writerTools();
  const canStart = async (kinds: string[]) => {
    const result = await run("request_approval", { kinds });
    return [JSON.parse(String(result.content)).canStart, result.detail];
  };

  // The filed constraints are not approved yet, so approving the brief opens nothing.
  expect(await canStart(["problem_brief"])).toEqual([[], undefined]);
  inFlight.push({
    runId: "w",
    role: "writer",
    status: "running",
    state: "working",
  });
  expect(await canStart(["constraints"])).toEqual([[], undefined]);
  inFlight.pop();
  expect(await canStart(["constraints"])).toEqual([
    ["approaches"],
    { canStart: ["approaches"] },
  ]);

  for (const kind of ["approaches", "product_requirements"])
    documents.push({
      kind,
      artifactId: kind,
      title: kind,
      version: 1,
      sha256: "a".repeat(64),
    });
  expect(await canStart(["approaches", "product_requirements"])).toEqual([
    ["design"],
    { canStart: ["design"] },
  ]);
  inFlight.push({
    runId: "d",
    role: "designer",
    status: "running",
    state: "working",
  });
  expect(await canStart(["product_requirements"])).toEqual([[], undefined]);
  inFlight.pop();
  documents.push({
    kind: "design_option",
    artifactId: "o",
    title: "Calm",
    version: 1,
    sha256: "a".repeat(64),
  });
  expect(await canStart(["product_requirements"])).toEqual([[], undefined]);
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
  expect(deployed).toEqual([
    "@corbits-builder/writer-approaches-native@1.0.0",
    "@corbits-builder/writer-constraints-native@1.0.0",
  ]);
});

test("deploy_writer offers only the kinds a writer saves", async () => {
  const { run, deployed } = writerTools({ agent_decides_approvals: "yes" });
  expect(
    (await run("deploy_writer", writer("engineering_review"))).isError,
  ).toBe(true);
  expect(deployed).toEqual([]);
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

// The coordinator's question check, reading project values from a hub that answers with response.
function questionCheck(response: () => Response) {
  const asked: string[] = [];
  const fetch = async (path: string) => {
    asked.push(path);
    return response();
  };
  const capabilities = {
    resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
  } as unknown as RuntimeCapabilities;
  const { checkQuestion } = createDeployTools("classic", {
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 16384,
  })({ capabilities } as never);
  if (!checkQuestion) throw new Error("the deploy tools check no questions");
  return {
    asked,
    check: (plugin: string, input: Record<string, unknown>) =>
      checkQuestion({ plugin, input }),
  };
}

const fontsInUse = () =>
  Response.json({
    values: { "look.font-primary": "Inter", "look.font-secondary": null },
  });

test("a pick-fonts question the screen can draw is let through, checked against the project's fonts", async () => {
  const { asked, check } = questionCheck(fontsInUse);
  expect(
    await check("pick-fonts", { proposed: { primary: "Fraunces" } }),
  ).toBeUndefined();
  expect(asked).toEqual([
    "/api/tenants/tenant/projects/project/values?keys=look.font-primary%2Clook.font-secondary",
  ]);
  expect(await check("pick-fonts", { proposed: { primary: "Inter" } })).toBe(
    [
      "pick-fonts was not shown. One field is wrong.",
      "",
      'proposed: "Inter" is already the font in use.',
      "",
      'Your other fields were fine: list "all".',
      "Call again proposing a different font, or with no proposal to let the person choose.",
    ].join("\n"),
  );
});

test("a pick-fonts question is not let through when the project's fonts cannot be read", async () => {
  const { check } = questionCheck(() =>
    Response.json({ code: "forbidden" }, { status: 403 }),
  );
  await expect(check("pick-fonts", {})).rejects.toThrow(
    "workflow_http_unavailable:http_403",
  );
});

test("a pick-fonts question with an unknown list is refused with every list and how to fix it", async () => {
  const { check } = questionCheck(fontsInUse);
  expect(
    await check("pick-fonts", {
      proposed: { primary: "Fraunces" },
      list: "handwriting",
    }),
  ).toBe(
    [
      "pick-fonts was not shown. One field is wrong.",
      "",
      'list: "handwriting" is not a list.',
      "  Use one of:",
      "    all      Every font. Use when the person has no preference.",
      "    sans     Clean and modern. Good for apps and dashboards.",
      "    serif    Classic and bookish. Good for long reading and editorial pages.",
      "    display  Loud and characterful. Good for headings and logos, not body text.",
      "    mono     Every letter the same width. Good for code and figures.",
      "  Or pass up to 20 font names.",
      "",
      'Your other fields were fine: proposed {"primary":"Fraunces"}.',
      "Call again with the same input and list corrected, or leave list out to offer every font.",
    ].join("\n"),
  );
});

test("a question for a screen the hub does not have is refused with the installed screens", async () => {
  const { check } = questionCheck(fontsInUse);
  expect(await check("pick-colors", {})).toBe(
    [
      '"pick-colors" is not an installed screen plugin, so nothing was shown.',
      "",
      "Installed screen plugins:",
      "  pick-fonts: Shows the person the fonts in use and fonts to choose a primary and a secondary font from.",
      "  pick-colours: Shows the person the primary (brand) and background colours in use and lets them choose new ones.",
      "",
      "Call again with plugin set to one of them, or ask a plain question with questions instead.",
    ].join("\n"),
  );
});
