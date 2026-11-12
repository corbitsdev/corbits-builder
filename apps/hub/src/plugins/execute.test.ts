import { expect, test } from "bun:test";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { createExecuteTools } from "./tools.ts";

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
const workflows = {
  "writer-product-requirements": deployment,
  "writer-build-plan": deployment,
  "writer-document": deployment,
  reviewer: deployment,
  coder: deployment,
  designer: deployment,
};

type Filed = { kind: string; version: number; approvedVersion?: number };

// A project as the hub stores it, and what the coordinator's tools did to it.
function project(
  artifacts: Filed[],
  following: string[] = [],
  preferences: Record<string, string> = {},
) {
  const state = { artifacts, following, plan: [] as PlanStep[] };
  const deployed: string[] = [];
  const mailed: string[] = [];
  const approvals: unknown[] = [];
  const recorded: unknown[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(path);
      return Response.json({
        id: "run-" + String(deployed.length),
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/artifacts"))
      return Response.json({
        artifacts: state.artifacts.map(
          ({ kind, version, approvedVersion }) => ({
            kind,
            artifactId: kind,
            title: kind,
            version,
            approvedVersion,
            sha256: "a".repeat(64),
          }),
        ),
        inFlight: [],
        appBuilt: false,
        preferences,
      });
    if (path.endsWith("/following")) {
      if (body) state.following = body.following;
      return Response.json({ following: state.following });
    }
    if (path.endsWith("/run-actions")) {
      recorded.push(body);
      return Response.json(body);
    }
    if (path.includes("/values?")) {
      const keys = new URL(path, "http://hub").searchParams.get("keys") ?? "";
      return Response.json({
        values: Object.fromEntries(keys.split(",").map((key) => [key, null])),
      });
    }
    if (path.endsWith("/checks")) return Response.json({ checks: [] });
    if (path.endsWith("/plan")) {
      if (body) state.plan = body.steps.map(stored);
      return Response.json({ steps: state.plan, updatedAt: null });
    }
    if (path.endsWith("/run-records")) return Response.json(body);
    if (path.endsWith("/artifact-approvals")) {
      approvals.push(body);
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
  const tools = createExecuteTools({
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows,
    maxResultBytes: 65536,
  })({ capabilities } as never);
  const call = (name: string, args: Record<string, unknown>) =>
    tools.run(
      { id: "call", name, arguments: args },
      new AbortController().signal,
    );
  return {
    state,
    deployed,
    mailed,
    approvals,
    recorded,
    definitions: tools.definitions.map(({ name }) => name),
    execute: (asked: Record<string, unknown>) => call("execute", asked),
    discover: (args: Record<string, unknown>) => call("discover", args),
    plan: (args: Record<string, unknown>) => call("plan", args),
  };
}

// A plan step as the hub stores it with an id, shown as not started.
type PlanStep = {
  id?: string;
  state?: string;
  kind?: string;
  steps?: PlanStep[];
};
let lastId = 0;
function stored(step: PlanStep): PlanStep {
  step.id ??= `s${++lastId}`;
  step.state = "not_started";
  if (step.steps) step.steps.forEach(stored);
  else step.kind = "workflow";
  return step;
}

const change = {
  instruction: "Change the app's font to Inter for all text, and nothing else.",
};
const build = {
  instruction:
    "Build the whole app as the requirements describe it, phone first.",
  starter: "web-app",
};
const coderBuild = { plugin: "coder", action: "build", input: build };
const designerMockup = {
  plugin: "designer",
  action: "mockup",
  input: {
    instruction:
      "Design a mockup of a dog-walking app for owners booking walks.",
    lookIdeas: "Friendly and warm, left to you.",
    concepts: [
      { label: "Park", direction: "Greens, rounded type, soft radii." },
    ],
  },
};

test("the dynamic coordinator starts work with execute and offers no staged tool", () => {
  expect(project([]).definitions).toEqual([
    "discover",
    "execute",
    "runs",
    "plan",
    "question",
  ]);
});

test("execute refuses an unknown plugin, a bad input and a screen, and starts nothing", async () => {
  const empty = project([filed("app")]);
  const unknown = await empty.execute({
    plugin: "polish-app",
    action: "polish",
    input: change,
  });
  expect(unknown.isError).toBe(true);
  expect(unknown.content).toStartWith(
    '"polish-app" is not an installed plugin, so nothing was started.',
  );
  expect(unknown.content).toContain("coder change");

  const malformed = await empty.execute({ plugn: "coder", action: "change" });
  expect(malformed.isError).toBe(true);
  expect(malformed.content).toStartWith(
    "execute was not run, so nothing was started. 2 fields are wrong:\n  plugin: must be a string (was missing)\n  plugn: execute takes no plugn",
  );
  expect(malformed.content).toContain("What execute takes:\nInput:\n  plugin");

  const bad = await empty.execute({
    plugin: "coder",
    action: "change",
    input: { instruction: "Inter" },
  });
  expect(bad.isError).toBe(true);
  expect(bad.content).toStartWith(
    "coder change was not started. One field is wrong.\n\ninstruction: must be at least length 40",
  );

  expect(
    (await empty.execute({ plugin: "designer", action: "pick-fonts" })).content,
  ).toBe(
    'designer pick-fonts is a screen, so nothing was started. A screen is opened with question({ plugin: "designer", action: "pick-fonts", input }).',
  );
  expect(empty.deployed).toEqual([]);
});

function filed(kind: string, approved = false): Filed {
  return approved
    ? { kind, version: 1, approvedVersion: 1 }
    : { kind, version: 1 };
}

test("coder change starts a coder on a project that holds only an imported app, and records no approval", async () => {
  const imported = project([filed("app")]);
  const started = await imported.execute({
    plugin: "coder",
    action: "change",
    input: change,
  });
  expect(started.isError).toBeUndefined();
  expect(JSON.parse(String(started.content))).toEqual({
    started: true,
    plugin: "coder",
    action: "change",
    runs: [{ runId: "run-1" }],
  });
  expect(imported.recorded).toEqual([
    { runId: "run-1", plugin: "coder", action: "change" },
  ]);
  expect(imported.deployed).toHaveLength(1);
  expect(imported.mailed[0]).toContain(change.instruction);
  expect(imported.mailed[0]).toContain(
    "save it with report_values({ name: value }); it saves only these:\n- stack.language (text)",
  );
  expect(imported.approvals).toEqual([]);
  expect(imported.state.following).toEqual([]);
});

test("coder build is refused without the filed requirements or build plan, and once an app exists", async () => {
  const empty = project([]);
  expect((await empty.execute(coderBuild)).content).toStartWith(
    [
      "coder build was not started. The project does not have what it needs yet.",
      "",
      "It needs one of these:",
      "  - the product requirements are filed (analyst analyse or writer write or writer write-requirements makes this true)",
      "  - the build plan is filed (analyst analyse or writer write or writer write-build-plan makes this true)",
    ].join("\n"),
  );
  expect(empty.deployed).toEqual([]);

  const built = project([filed("product_requirements"), filed("app")]);
  expect((await built.execute(coderBuild)).content).toStartWith(
    [
      "coder build was not started. The project does not have what it needs yet.",
      "",
      "It needs one of these:",
      "  - the project has no code yet",
    ].join("\n"),
  );
  expect(built.deployed).toEqual([]);
});

test("on build-web-app, coder build waits for the person's go-ahead while they decide approvals, and otherwise starts with the plan's advice", async () => {
  const following = project([filed("build_plan")], ["build-web-app"]);
  const refused = await following.execute(coderBuild);
  expect(refused.content).toBe(
    [
      "coder build was not started. The project does not have what it needs yet.",
      "",
      "This project is following the build-web-app plan, which asks for the person's go-ahead first:",
      "  - the person approved the current version of the build plan, or leaves approvals to you (writer approve makes this true)",
      "  - the person chose a design from the design options (designer review or designer choose makes this true)",
      "",
      "Start what makes these true first, or ask the person, then call execute again.",
      "If the person directs the work elsewhere, take the build-web-app plan's group out of the project's plan with plan({ operation: \"remove\", stepIds }); the project then stops following it.",
    ].join("\n"),
  );
  expect(following.deployed).toEqual([]);

  const leftToBuilder = project([filed("build_plan")], ["build-web-app"], {
    agent_decides_approvals: "yes",
  });
  const started = JSON.parse(
    String((await leftToBuilder.execute(coderBuild)).content),
  );
  expect(started.advice).toBe(
    "The build-web-app plan suggests doing this first: the person chose a design from the design options (designer review or designer choose makes this true). The plan orders the work so each step builds on what the one before made; this started without it.",
  );
  expect(leftToBuilder.deployed).toHaveLength(1);
});

test("designer mockup starts a designer with nothing filed, unless the project follows build-web-app and the requirements are not approved", async () => {
  const alone = project([]);
  expect(
    JSON.parse(String((await alone.execute(designerMockup)).content)),
  ).toEqual({
    started: true,
    plugin: "designer",
    action: "mockup",
    runs: [{ runId: "run-1", concept: "Park" }],
    presents: ["designer choose", "designer review"],
  });
  expect(alone.deployed).toHaveLength(1);

  const following = project([filed("product_requirements")], ["build-web-app"]);
  const refused = await following.execute(designerMockup);
  expect(refused.isError).toBe(true);
  expect(refused.content).toContain(
    "This project is following the build-web-app plan, which asks for the person's go-ahead first:\n  - the person approved the current version of the product requirements",
  );
  expect(following.deployed).toEqual([]);

  following.state.artifacts = [filed("product_requirements", true)];
  expect((await following.execute(designerMockup)).isError).toBeUndefined();
  expect(following.deployed).toHaveLength(1);
});

test("execute on build-web-app is turned to plan add, which puts the plan's steps on the project's plan and has it followed", async () => {
  const idea = project([filed("product_requirements", true)]);
  const refused = await idea.execute({ plugin: "build-web-app" });
  expect(refused.isError).toBe(true);
  expect(refused.content).toBe(
    'build-web-app is a ready-made plan, not an action, so it is neither started nor held as one step. Take it up with plan({ operation: "add", plan: "build-web-app" }), which puts its steps on the project\'s plan as a group and has the project follow it.',
  );
  expect(idea.state.following).toEqual([]);

  const added = await idea.plan({ operation: "add", plan: "build-web-app" });
  expect(added.isError).toBeUndefined();
  expect(idea.state.following).toEqual(["build-web-app"]);
  expect(idea.state.plan).toHaveLength(1);
  expect(idea.state.plan[0]?.steps).toHaveLength(5);
  expect(added.content).toContain(
    "The project is now following the build-web-app plan.",
  );
  expect(added.content).toContain("# Build a web app from an idea");
  expect(added.content).toEndWith(
    [
      "Where each step stands now:",
      "  writer write-requirements: can start now",
      "  designer mockup: can start now",
      "  writer write-build-plan: needs the person's go-ahead, which the build-web-app plan asks for: the person chose a design from the design options",
      "  coder build: needs the person's go-ahead, which the build-web-app plan asks for: the person approved the current version of the build plan, or leaves approvals to you and the person chose a design from the design options",
      "  writer write (optional, the person may decline it): can start now; the build-web-app plan suggests first: the project has code, built or imported",
    ].join("\n"),
  );
  const found = await idea.discover({ query: "build me an app" });
  expect(found.content).toContain("This project is following it.");
  expect(found.content).toContain(
    "  build: The project has no code yet and its requirements or build plan say what to build. Now: needs the person's go-ahead, which the build-web-app plan asks for: the person approved",
  );
  const guidance = await idea.discover({
    plugin: "coder",
    action: "build",
  });
  expect(guidance.content).toContain(
    "coder build: Has the coder build the project's code for the first time from the filed documents and, when one is chosen, the design. The documents are the assignment.\nUse it when: The project has no code yet and its requirements or build plan say what to build.\nNot when: The project already has code; a change to it is coder change.\nRequires: the product requirements are filed and the project has no code yet; or the build plan is filed and the project has no code yet.\n",
  );
  expect(guidance.content).toContain(
    "Now: needs the person's go-ahead, which the build-web-app plan asks for: the person approved",
  );
});

test("taking the plan's group out stops the project following it, and so does the app existing", async () => {
  const following = project([]);
  await following.plan({ operation: "add", plan: "build-web-app" });
  const group = following.state.plan[0]?.id;
  await following.plan({ operation: "remove", stepIds: [group] });
  expect(following.state.plan).toEqual([]);
  expect(following.state.following).toEqual([]);

  const built = project([filed("app")], ["build-web-app"]);
  expect((await built.execute(designerMockup)).isError).toBeUndefined();
  expect(built.state.following).toEqual([]);
});
