import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { nativePackageName } from "./package-name.ts";
import type { RoleBinding } from "@corbits-builder/schemas/models";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";

// The version follows the bundle bytes, so a rebuilt workflow publishes beside the old one instead of
// colliding with a tarball the registry already holds.
function contentVersion(base: string, bundle: string): string {
  return `${base}-sha-${createHash("sha256").update(bundle).digest("hex").slice(0, 8)}`;
}

// Each package is an entry under entries/ built on its role's model binding.
const WORKFLOW_PACKAGES: readonly { name: string; role: WorkflowRole }[] = [
  ...(["coordinator", "writer", "reviewer", "coder", "designer"] as const).map(
    (role) => ({
      name: role,
      role,
    }),
  ),
  { name: "coder-any-package", role: "coder" },
];

export async function buildWorkflowPackages(
  destination: string,
  base: string,
  bindings: Record<WorkflowRole, RoleBinding>,
) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error("invalid_package_version");
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (const { name, role } of WORKFLOW_PACKAGES) {
    const result = await Bun.build({
      define: {
        "process.env.BUILDER_ROLE_INFERENCE": JSON.stringify(
          JSON.stringify(bindings[role]),
        ),
      },
      entrypoints: [join(import.meta.dir, "entries", name + ".ts")],
      target: "bun",
      format: "esm",
      minify: true,
      conditions: ["intx-src"],
    });
    if (!result.success || result.outputs.length !== 1)
      throw new Error(
        "workflow_package_build_failed:" +
          name +
          (result.logs.length > 0
            ? " " + result.logs.map(String).join("; ")
            : ""),
      );
    const bundle = await result.outputs[0]!.text();
    const version = contentVersion(base, bundle);
    const staging = await mkdtemp(join(tmpdir(), "sb-workflow-package-"));
    const packageName = nativePackageName(name);
    const filename = name + "-native-" + version + ".tgz";
    try {
      await mkdir(join(staging, "package", "dist"), { recursive: true });
      await writeFile(join(staging, "package", "dist", "workflow.mjs"), bundle);
      await writeFile(
        join(staging, "package", "package.json"),
        JSON.stringify({
          name: packageName,
          version,
          type: "module",
          exports: { ".": "./dist/workflow.mjs" },
          interchange: {
            workflow: "./dist/workflow.mjs",
            directors: "./dist/workflow.mjs",
          },
        }),
      );
      const tar = Bun.spawn(
        ["tar", "-czf", join(output, filename), "-C", staging, "package"],
        {
          stdout: "ignore",
          stderr: "pipe",
        },
      );
      if ((await tar.exited) !== 0)
        throw new Error("workflow_package_archive_failed");
      manifest.push({
        assetName: "sb-" + name + "-packages",
        filename,
        packageName,
        version,
        entry: "./dist/workflow.mjs",
        file: filename,
      });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
