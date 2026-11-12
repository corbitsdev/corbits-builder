import { expect, test } from "bun:test";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { MODEL_PROVIDERS, workflowBindings } from "../config/models.ts";
import { resolveRoleInference, type RoleInference } from "./role-inference.ts";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";

const bindings = workflowBindings(MODEL_PROVIDERS, {
  profile: "anthropic_default",
});
const inference = Object.fromEntries(
  Object.entries(bindings).map(([role, binding]) => [
    role,
    resolveRoleInference(MODEL_PROVIDERS, role as WorkflowRole, binding),
  ]),
) as Record<WorkflowRole, RoleInference>;

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

test("production entries expose concrete native workflows without callback credentials", async () => {
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(inference.coordinator);
  const coordinator = (await import("./entries/coordinator.ts")).default;
  const writers = [
    (
      await import("@corbits-builder/writer/packages/writer-product-requirements")
    ).default,
    (await import("@corbits-builder/writer/packages/writer-build-plan"))
      .default,
    (await import("@corbits-builder/writer/packages/writer-document")).default,
  ];
  const reviewer = (await import("@corbits-builder/writer/packages/reviewer"))
    .default;
  const coder = (await import("@corbits-builder/coder/packages/coder")).default;
  const coderAnyPackage = (
    await import("@corbits-builder/coder/packages/coder-any-package")
  ).default;
  const designer = (await import("@corbits-builder/designer/packages/designer"))
    .default;
  const presenter = (
    await import("@corbits-builder/presenter/packages/presenter")
  ).default;
  expect(coordinator.steps.coordinate).toMatchObject({ triggers: "unbounded" });
  for (const writer of writers)
    expect(writer.steps.write).toMatchObject({ triggers: 1 });
  expect(reviewer.steps.review).toMatchObject({ triggers: 1 });
  expect(coder.steps.build).toMatchObject({ triggers: 1 });
  expect(coderAnyPackage.steps.build).toMatchObject({ triggers: 1 });
  expect(designer.steps.design).toMatchObject({ triggers: 1 });
  expect(presenter.steps.present).toMatchObject({ triggers: 1 });
  // Secure by default: only the coder a person opted into declares install_packages without an ask.
  const installTool = (workflow: typeof coder) => {
    const step = workflow.steps.build;
    if (!step || !("agent" in step))
      throw new Error("coder_build_step_missing");
    return step.agent.toolFactories
      .flatMap((factory) => factory.definitions ?? [])
      .find((definition) => definition.name === "install_packages");
  };
  expect(installTool(coder)).toEqual({
    name: "install_packages",
    approval: "ask",
  });
  expect(installTool(coderAnyPackage)).toEqual({ name: "install_packages" });
  for (const workflow of [
    coordinator,
    ...writers,
    reviewer,
    coder,
    coderAnyPackage,
    designer,
    presenter,
  ]) {
    expect(workflow.credentialBindings ?? []).toEqual([]);
    // A trimmed result's note names read_file, so every agent needs one.
    const tools = Object.values(workflow.steps).flatMap((step) =>
      "agent" in step
        ? step.agent.toolFactories.flatMap(
            (factory) => factory.definitions ?? [],
          )
        : [],
    );
    expect(tools.map((tool) => tool.name)).toContain("read_file");
  }
  expect(
    JSON.stringify([
      coordinator,
      ...writers,
      reviewer,
      coder,
      coderAnyPackage,
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
    expect(manifest).toHaveLength(11);
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
      expect(entry.default.credentialBindings ?? []).toEqual([]);
    }
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
    // question is Interchange's own tool, offered by the bundle that checks a screen's input.
    expect(declared.map(({ name }) => name)).toEqual([
      "read_artifact",
      "discover",
      "execute",
      "runs",
      "plan",
      "read_file",
    ]);
    expect(declared.filter((definition) => definition.approval)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
