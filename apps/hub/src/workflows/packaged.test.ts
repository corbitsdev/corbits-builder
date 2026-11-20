import { afterAll, expect, test } from "bun:test";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { MODEL_PROVIDERS, tierBinding } from "../config/models.ts";
import { projectLiveToInert } from "@intx/workflow/projection";
import { browserCatalog } from "../builds/browser-catalog.ts";
import { nativePackageName } from "./package-name.ts";
import { resolveRoleInference, type RoleInference } from "./role-inference.ts";
import { spawnedWorkflowRole, workflowStep } from "./spawn-role.ts";
import { resolve } from "node:path";
import {
  CATALOG,
  PLUGINS_FOLDER,
  roleModel,
  runRole,
  WORKFLOW_PACKAGES,
} from "../plugins/catalog.ts";

const AGENT_ENTRY = "./agent-package.ts";
let browser: string | undefined;

// installed sets these for each import, so the process gets back what it had once this file is done.
const SET = ["BUILDER_AGENT", "BUILDER_BROWSER", "BUILDER_TOOLS"] as const;
const had = SET.map((name) => [name, process.env[name]] as const);
afterAll(() => {
  for (const [name, value] of had)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

// An installed plugin's workflow package by name: the agent it declares, built as build-packages.ts
// builds it, else loaded from the entry its plugin names for it. The agent's declaration reaches
// the shared entry through the environment, so one is built at a time, each run of the module with
// its own declaration set the moment it is imported.
async function installed(name: string) {
  const brought = CATALOG.packages.get(name);
  if (brought === undefined) throw new Error(`no installed package ${name}`);
  if (!("agent" in brought))
    return (await import(resolve(PLUGINS_FOLDER, brought.entry))).default;
  browser ??= JSON.stringify(await browserCatalog());
  process.env.BUILDER_AGENT = JSON.stringify(brought.agent);
  process.env.BUILDER_BROWSER = browser;
  if (brought.agent.tools === null) delete process.env.BUILDER_TOOLS;
  else process.env.BUILDER_TOOLS = resolve(PLUGINS_FOLDER, brought.agent.tools);
  return (await import(`${AGENT_ENTRY}?${name}`)).default;
}

// The workflow a package is built from, as build-packages.ts finds it: a plugin's, else the hub's own.
// A workflow reads its role's inference when imported, so it is set for the import and put back.
async function source(name: string) {
  const before = process.env.BUILDER_ROLE_INFERENCE;
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(
    inference[WORKFLOW_PACKAGES.get(name) ?? name],
  );
  try {
    return CATALOG.packages.has(name)
      ? await installed(name)
      : (await import(`./entries/${name}.ts`)).default;
  } finally {
    if (before === undefined) delete process.env.BUILDER_ROLE_INFERENCE;
    else process.env.BUILDER_ROLE_INFERENCE = before;
  }
}

// Each named package in turn, never two at once.
async function installedInTurn(names: readonly string[]) {
  const built = [];
  for (const name of names) built.push(await installed(name));
  return built;
}

// What each role an installed package plays resolves to on the shipped Anthropic profile.
const inference: Record<string, RoleInference> = Object.fromEntries(
  [...new Set(WORKFLOW_PACKAGES.values())].map((name) => {
    const model = roleModel(runRole(name));
    return [
      name,
      resolveRoleInference(
        MODEL_PROVIDERS,
        model.budget,
        tierBinding(MODEL_PROVIDERS, { profile: "anthropic_default" }, model),
      ),
    ];
  }),
);

test("native specialist accepts installed tarballs only with an exact package pin", () => {
  const deployment: NativeSpecialistDeployment = {
    source: {
      kind: "asset",
      assetId: "asset_packages",
      package: { format: "tarball" },
    },
    pin: "@corbits-builder/writer-native@1.0.0",
    entry: "dist/workflow.mjs",
    sourceOfferingIds: ["offering"],
    defaultSourceOfferingId: "offering",
  };
  expect(NativeSpecialistDeployment.assert(deployment)).toEqual(deployment);
  expect(() =>
    NativeSpecialistDeployment.assert({ ...deployment, pin: undefined }),
  ).toThrow();
});

// What these tests read of an agent's tool bundles.
type Factories = { definitions?: { name: string; approval?: string }[] }[];

test("production entries expose concrete native workflows without callback credentials", async () => {
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(inference.coordinator);
  const coordinator = (await import("./entries/coordinator.ts")).default;
  const writerNames = [
    "writer-product-requirements",
    "writer-build-plan",
    "writer-document",
  ];
  const writers = await installedInTurn(writerNames);
  const [reviewer, coder, designer, presenter] = await installedInTurn([
    "reviewer",
    "coder",
    "designer",
    "presenter",
  ]);
  // Each writer is its own package, and a writer of one kind files only that kind.
  const filing = (writer: (typeof writers)[number]) => {
    const artifacts = writer.steps.work.agent.toolFactories.find(
      (factory: { id: string }) =>
        factory.id === "@corbits-builder/artifacts/tools",
    );
    return artifacts({}).definitions.find(
      (definition: { name: string }) => definition.name === "write_artifact",
    ).description;
  };
  expect(writers.map((writer) => writer.id)).toEqual(
    writerNames.map((name) => `corbits-builder-${name}`),
  );
  expect(writers.map((writer) => writer.steps.work.agent.id)).toEqual(
    writerNames,
  );
  expect(filing(writers[0])).toStartWith(
    "Write the next version of the product requirements.",
  );
  expect(filing(writers[1])).toStartWith(
    "Write the next version of the build plan.",
  );
  expect(filing(writers[2])).toStartWith(
    "Write the next version of the document your task names.",
  );
  expect(coordinator.steps.coordinate).toMatchObject({ triggers: "unbounded" });
  for (const agent of [...writers, reviewer, coder, designer, presenter])
    expect(agent.steps.work).toMatchObject({ triggers: 1 });
  // Secure by default: the coder declares install_packages as a tool that asks.
  const factories: Factories = coder.steps.work.agent.toolFactories;
  expect(
    factories
      .flatMap((factory) => factory.definitions ?? [])
      .find((definition) => definition.name === "install_packages"),
  ).toEqual({ name: "install_packages", approval: "ask" });
  for (const workflow of [
    coordinator,
    ...writers,
    reviewer,
    coder,
    designer,
    presenter,
  ]) {
    expect(workflow.credentialBindings ?? []).toEqual([]);
    // A trimmed result's note names read_file, so every agent needs one.
    const steps: { agent?: { toolFactories: Factories } }[] = Object.values(
      workflow.steps,
    );
    const tools = steps.flatMap((step) =>
      (step.agent?.toolFactories ?? []).flatMap(
        (factory) => factory.definitions ?? [],
      ),
    );
    expect(tools.map((tool) => tool.name)).toContain("read_file");
  }
  expect(
    JSON.stringify([
      coordinator,
      ...writers,
      reviewer,
      coder,
      designer,
      presenter,
    ]),
  ).not.toMatch(/prepareOwnerContext|finish_task/);
});

test("built npm tarballs contain importable production workflow metadata and definitions", async () => {
  const { mkdtemp, rm, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { buildWorkflowPackages } = await import("./build-packages.ts");
  const directory = await mkdtemp(
    join(tmpdir(), "sb-packaged-definition-test-"),
  );
  try {
    const manifest = await buildWorkflowPackages(directory, "1.0.0", inference);
    let optional = 0;
    for (const metadata of manifest) {
      const extracted = join(directory, metadata.assetName);
      await mkdir(extracted);
      const child = Bun.spawn(
        ["tar", "-xzf", join(directory, metadata.file), "-C", extracted],
        {
          stdout: "ignore",
          stderr: "pipe",
        },
      );
      expect(await child.exited).toBe(0);
      const pkg = await Bun.file(
        join(extracted, "package", "package.json"),
      ).json();
      expect(pkg.name).toBe(metadata.packageName);
      expect(pkg.interchange.workflow).toBe(metadata.entry);
      const entry = await import(
        pathToFileURL(join(extracted, "package", metadata.entry)).href
      );
      expect(entry.director).toBeDefined();
      expect(Object.keys(entry.default.steps)).toHaveLength(1);
      const name = [...WORKFLOW_PACKAGES.keys()].find(
        (each) => nativePackageName(each) === metadata.packageName,
      );
      if (name === undefined)
        throw new Error(`${metadata.packageName} is no installed package`);
      const bindings: { handle: string; optional?: true }[] =
        entry.default.credentialBindings ?? [];
      expect(bindings).toEqual((await source(name)).credentialBindings ?? []);
      // A credential the run may start without, one the person can do without or one the hub makes,
      // stays optional in the package.
      const brought = CATALOG.packages.get(name);
      if (brought !== undefined && "agent" in brought)
        for (const binding of bindings) {
          expect(binding.optional === true).toBe(
            brought.agent.optional.includes(binding.handle),
          );
          if (binding.optional) optional += 1;
        }
      // A package is installed for the role its agent's tags name.
      expect(
        workflowStep({ projection: projectLiveToInert(entry.default) }, CATALOG)
          ?.role,
      ).toBe(WORKFLOW_PACKAGES.get(name));
      // The hub accepts a run as a specialist's only when its launch bundle yields a role.
      if (metadata.packageName !== nativePackageName("coordinator"))
        expect(
          spawnedWorkflowRole({
            projection: projectLiveToInert(entry.default),
          }),
        ).toBeDefined();
    }
    expect(manifest).toHaveLength(WORKFLOW_PACKAGES.size);
    expect(optional).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  // Building starts the coder's browser, whose first start downloads Chrome for Testing.
}, 180_000);

test("the built coordinator runs its prompt with the plugin tools and no tool waits on the person", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { buildWorkflowPackages } = await import("./build-packages.ts");
  const { nativePackageName } = await import("./package-name.ts");
  const { composeCoordinatorPrompt } =
    await import("@corbits-builder/coordinator/prompt");
  const directory = await mkdtemp(join(tmpdir(), "sb-coordinator-prompt-"));
  try {
    const manifest = await buildWorkflowPackages(directory, "1.0.0", inference);
    const coordinator = manifest.find(
      (item) => item.packageName === nativePackageName("coordinator"),
    );
    if (!coordinator) throw new Error("coordinator_package_missing");
    const child = Bun.spawn(
      ["tar", "-xzf", join(directory, coordinator.file), "-C", directory],
      { stdout: "ignore", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    const entry = await import(
      pathToFileURL(join(directory, "package", coordinator.entry)).href
    );
    const { systemPrompt, toolFactories } =
      entry.default.steps.coordinate.agent;
    const declared: { name: string; approval?: string }[] =
      toolFactories.flatMap(
        (tool: { definitions: { name: string; approval?: string }[] }) =>
          tool.definitions,
      );
    expect(systemPrompt).toBe(composeCoordinatorPrompt());
    // question is Interchange's own tool, authorized like any other, so its bundle declares it.
    expect(declared.map(({ name }) => name)).toEqual([
      "read_artifact",
      "discover",
      "execute",
      "runs",
      "plan",
      "question",
      "read_file",
    ]);
    expect(declared.filter((definition) => definition.approval)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
