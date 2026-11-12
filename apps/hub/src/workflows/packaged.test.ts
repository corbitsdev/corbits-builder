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
    (await import("./entries/writer-constraints.ts")).default,
    (await import("./entries/writer-approaches.ts")).default,
    (await import("./entries/writer-product-requirements.ts")).default,
    (await import("./entries/writer-build-plan.ts")).default,
    (await import("./entries/writer-document.ts")).default,
  ];
  const reviewer = (await import("./entries/reviewer.ts")).default;
  const coder = (await import("./entries/coder.ts")).default;
  const coderAnyPackage = (await import("./entries/coder-any-package.ts"))
    .default;
  const designer = (await import("./entries/designer.ts")).default;
  const presenter = (await import("./entries/presenter.ts")).default;
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
    const manifest = await buildWorkflowPackages(
      directory,
      "1.0.0",
      inference,
      "classic",
    );
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

test("the built coordinator runs the prompt and tool marks COORDINATOR_MODE names, and the hub refuses any other", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { buildWorkflowPackages } = await import("./build-packages.ts");
  const { nativePackageName } = await import("./package-name.ts");
  const { readCoordinatorMode } = await import("../environment.ts");
  const { composeCoordinatorPrompt } =
    await import("@corbits-builder/coordinator/prompt");
  expect(() => readCoordinatorMode({ COORDINATOR_MODE: "lean" })).toThrow(
    "COORDINATOR_MODE must be classic or dynamic",
  );
  const built = async (setting: string | undefined) => {
    const directory = await mkdtemp(join(tmpdir(), "sb-coordinator-prompt-"));
    try {
      const manifest = await buildWorkflowPackages(
        directory,
        "1.0.0",
        inference,
        readCoordinatorMode({ COORDINATOR_MODE: setting }),
      );
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
      return {
        systemPrompt,
        tools: declared.map(({ name }) => name),
        marks: declared.filter((definition) => definition.approval),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  const classic = composeCoordinatorPrompt("classic");
  const dynamic = composeCoordinatorPrompt("dynamic");
  expect(classic).not.toBe(dynamic);
  const ask = (...names: string[]) =>
    names.map((name) => ({ name, approval: "ask" }));
  const classicBuild = {
    systemPrompt: classic,
    tools: [
      "read_artifact",
      "write_artifact",
      "request_approval",
      "deploy_writer",
      "review_artifact",
      "deploy_coder",
      "instruct_coder",
      "design_app",
      "deploy_presenter",
      "read_skill",
      "discover",
      "read_file",
    ],
    marks: ask("request_approval", "instruct_coder", "design_app"),
  };
  expect(await built(undefined)).toEqual(classicBuild);
  expect(await built("classic")).toEqual(classicBuild);
  // question is Interchange's own tool, offered by the bundle that checks a screen's input.
  expect(await built("dynamic")).toEqual({
    systemPrompt: dynamic,
    tools: [
      "read_artifact",
      "discover",
      "execute",
      "request_approval",
      "read_file",
    ],
    marks: ask("request_approval"),
  });
}, 180_000);
