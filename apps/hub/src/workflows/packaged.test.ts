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
  const writer = (await import("./entries/writer.ts")).default;
  const reviewer = (await import("./entries/reviewer.ts")).default;
  const coder = (await import("./entries/coder.ts")).default;
  const coderAnyPackage = (await import("./entries/coder-any-package.ts"))
    .default;
  const designer = (await import("./entries/designer.ts")).default;
  expect(coordinator.steps.coordinate).toMatchObject({ triggers: "unbounded" });
  expect(writer.steps.write).toMatchObject({ triggers: 1 });
  expect(reviewer.steps.review).toMatchObject({ triggers: 1 });
  expect(coder.steps.build).toMatchObject({ triggers: "unbounded" });
  expect(coderAnyPackage.steps.build).toMatchObject({ triggers: "unbounded" });
  expect(designer.steps.design).toMatchObject({ triggers: "unbounded" });
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
    writer,
    reviewer,
    coder,
    coderAnyPackage,
    designer,
  ])
    expect(workflow.credentialBindings ?? []).toEqual([]);
  expect(
    JSON.stringify([
      coordinator,
      writer,
      reviewer,
      coder,
      coderAnyPackage,
      designer,
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
    expect(manifest).toHaveLength(6);
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
