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
  "writer-constraints": deployment,
  "writer-approaches": deployment,
  "writer-product-requirements": deployment,
  "writer-build-plan": deployment,
  "writer-document": deployment,
  reviewer: deployment,
  coder: deployment,
  designer: deployment,
};

type Filed = { kind: string; version: number; approvedVersion?: number };

// A project as the hub stores it, and what the coordinator's tools did to it.
function project(artifacts: Filed[], route: string | null = null) {
  const state = { artifacts, route };
  const deployed: string[] = [];
  const mailed: string[] = [];
  const approvals: unknown[] = [];
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
        preferences: {},
      });
    if (path.endsWith("/route")) {
      if (body) state.route = body.route;
      return Response.json({ route: state.route });
    }
    if (path.includes("/values?")) {
      const keys = new URL(path, "http://hub").searchParams.get("keys") ?? "";
      return Response.json({
        values: Object.fromEntries(keys.split(",").map((key) => [key, null])),
      });
    }
    if (path.endsWith("/design-concepts")) return Response.json(body);
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
    definitions: tools.definitions.map(({ name }) => name),
    execute: (asked: Record<string, unknown>) => call("execute", asked),
    discover: (args: Record<string, unknown>) => call("discover", args),
  };
}

const change = {
  instruction: "Change the app's font to Inter for all text, and nothing else.",
};
const build = {
  instruction:
    "Build the whole app as the requirements describe it, phone first.",
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
  expect(project([]).definitions).toEqual(["discover", "execute", "question"]);
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
  expect(started.content).toContain('"role":"coder"');
  expect(imported.deployed).toHaveLength(1);
  expect(imported.mailed[0]).toContain(change.instruction);
  expect(imported.approvals).toEqual([]);
  expect(imported.state.route).toBeNull();
});

test("coder build is refused until what it builds from is filed, then starts, and is refused once an app exists", async () => {
  const empty = project([]);
  const refused = await empty.execute(coderBuild);
  expect(refused.isError).toBe(true);
  expect(refused.content).toStartWith("coder build was not started.");
  expect(empty.deployed).toEqual([]);

  const planned = project([filed("product_requirements")]);
  expect((await planned.execute(coderBuild)).isError).toBeUndefined();
  expect(planned.deployed).toHaveLength(1);

  const built = project([filed("product_requirements"), filed("app")]);
  expect((await built.execute(coderBuild)).content).toBe(
    "The project already has an app, so its first build is done. A change to it is coder change.",
  );
  expect(built.deployed).toEqual([]);
});

test("on build-web-app, coder build names what it lacks of its own and what the route adds", async () => {
  const following = project([], "build-web-app");
  const refused = await following.execute(coderBuild);
  expect(refused.content).toBe(
    [
      "coder build was not started. The project does not have what it needs yet.",
      "",
      "It needs one of these:",
      "  - the product requirements are filed (writer write or writer write-requirements makes this true)",
      "  - the build plan is filed (writer write or writer write-build-plan makes this true)",
      "",
      "Because this project is following build-web-app, it also needs:",
      "  - the person approved the current version of the build plan, or leaves approvals to you (writer approve makes this true)",
      "  - the person chose a design from the design options (designer review or designer choose makes this true)",
      "",
      "Start what makes these true first, or ask the person, then call execute again.",
      'If the person directs the work elsewhere, take the project off the route with execute({ plugin: "build-web-app", input: { leave: true } }).',
    ].join("\n"),
  );
});

test("designer mockup starts a designer with nothing filed, unless the project follows build-web-app and the requirements are not approved", async () => {
  const alone = project([]);
  expect((await alone.execute(designerMockup)).content).toContain(
    '"role":"designer"',
  );
  expect(alone.deployed).toHaveLength(1);

  const following = project([filed("product_requirements")], "build-web-app");
  const refused = await following.execute(designerMockup);
  expect(refused.isError).toBe(true);
  expect(refused.content).toContain(
    "Because this project is following build-web-app, it also needs:\n  - the person approved the current version of the product requirements",
  );
  expect(following.deployed).toEqual([]);

  following.state.artifacts = [filed("product_requirements", true)];
  expect((await following.execute(designerMockup)).isError).toBeUndefined();
  expect(following.deployed).toHaveLength(1);
});

test("execute on build-web-app puts the project on it and returns its guidance and where each step stands", async () => {
  const idea = project([filed("product_requirements", true)]);
  const followed = await idea.execute({ plugin: "build-web-app" });
  expect(idea.state.route).toBe("build-web-app");
  expect(followed.content).toStartWith(
    "The project now follows build-web-app.",
  );
  expect(followed.content).toContain("# Build a web app from an idea");
  expect(followed.content).toEndWith(
    [
      "Where each step stands now:",
      "  writer write-requirements: can start now",
      "  designer mockup: can start now",
      "  writer write-build-plan: because this project is following build-web-app, it also needs: the person chose a design from the design options",
      "  coder build: because this project is following build-web-app, it also needs: the person approved the current version of the build plan, or leaves approvals to you and the person chose a design from the design options",
    ].join("\n"),
  );
  const found = await idea.discover({ query: "build me an app" });
  expect(found.content).toContain("This project is following it.");
  expect(found.content).toContain(
    "coder runs a specialist. Groups: build, change.",
  );
  expect(found.content).toContain(
    "coder build: Has the coder build the whole app for the first time from the filed documents and, when one is chosen, the design. The documents are the assignment.\nUse it when: The project has no app yet and its requirements or build plan say what to build.\nNot when: The project already has an app; a change to it is coder change.\nRequires: the product requirements are filed; or the build plan is filed.\nInput:",
  );
  expect(found.content).toContain(
    "Now:\n  coder build: because this project is following build-web-app, it also needs: the person approved",
  );
});

test("leave takes the project off the route, and so does the app existing", async () => {
  const following = project([], "build-web-app");
  expect(
    (
      await following.execute({
        plugin: "build-web-app",
        input: { leave: true },
      })
    ).content,
  ).toBe(
    "The project no longer follows build-web-app. Each action now needs only what it cannot work without.",
  );
  expect(following.state.route).toBeNull();

  const built = project([filed("app")], "build-web-app");
  expect((await built.execute(designerMockup)).isError).toBeUndefined();
  expect(built.state.route).toBeNull();
});
