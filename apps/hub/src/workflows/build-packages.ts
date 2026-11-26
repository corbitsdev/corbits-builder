import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bundledPlugins } from "@corbits-builder/plugin-host/bundle";
import {
  CATALOG,
  PLUGINS_FOLDER,
  WORKFLOW_PACKAGES,
} from "../plugins/catalog.ts";
import { browserCatalog } from "../builds/browser-catalog.ts";
import type { AgentPackage } from "@corbits-builder/plugin-host/catalog";
import { nativePackageName } from "./package-name.ts";
import type { RoleInference } from "./role-inference.ts";

// The version follows the bundle bytes, so a rebuilt workflow publishes beside the old one instead of
// colliding with a tarball the registry already holds.
function contentVersion(base: string, bundle: string): string {
  return `${base}-sha-${createHash("sha256").update(bundle).digest("hex").slice(0, 8)}`;
}

// The package entry an agent a plugin declares is built from, with the agent inlined.
const AGENT_ENTRY = join(import.meta.dir, "agent-package.ts");

// Each package is the entry a plugin names for it, the agent it declares, else the hub's own under
// entries/, built on what its role's model binding resolved to.
const PACKAGES = [...WORKFLOW_PACKAGES].map(([name, role]) => {
  const plugin = CATALOG.packages.get(name);
  if (plugin === undefined)
    return {
      name,
      role,
      entry: join(import.meta.dir, "entries", name + ".ts"),
    };
  if ("agent" in plugin)
    return { name, role, entry: AGENT_ENTRY, agent: plugin.agent };
  return { name, role, entry: resolve(PLUGINS_FOLDER, plugin.entry) };
});

// Whether an agent's workspace declares a browser, whose tools its package then lists.
const hasBrowser = ({ workspace }: AgentPackage) =>
  workspace?.kind === "app" && workspace.browser;

export async function buildWorkflowPackages(
  destination: string,
  base: string,
  inference: Readonly<Record<string, RoleInference>>,
) {
  if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error("invalid_package_version");
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  // Listing the browser's tools starts it, so they are listed once for every package.
  const browses = PACKAGES.some(
    (built) => "agent" in built && hasBrowser(built.agent),
  );
  const browser = browses ? JSON.stringify(await browserCatalog()) : undefined;
  const manifest = [];
  for (const built of PACKAGES) {
    const { name, role, entry } = built;
    const resolved = inference[role];
    if (!resolved) throw new Error(`role_inference_required:${role}`);
    const define: Record<string, string> = {
      "process.env.BUILDER_ROLE_INFERENCE": JSON.stringify(
        JSON.stringify(resolved),
      ),
    };
    if ("agent" in built) {
      define["process.env.BUILDER_AGENT"] = JSON.stringify(
        JSON.stringify(built.agent),
      );
      define["process.env.BUILDER_TOOLS"] =
        built.agent.tools === null
          ? "undefined"
          : JSON.stringify(resolve(PLUGINS_FOLDER, built.agent.tools));
    }
    if ("agent" in built && hasBrowser(built.agent))
      define["process.env.BUILDER_BROWSER"] = JSON.stringify(browser);
    const result = await Bun.build({
      define,
      entrypoints: [entry],
      target: "bun",
      format: "esm",
      minify: true,
      conditions: ["intx-src"],
      plugins: [bundledPlugins(PLUGINS_FOLDER)],
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
    const packageName = nativePackageName(name);
    const packageJson = JSON.stringify({
      name: packageName,
      version,
      type: "module",
      exports: { ".": "./dist/workflow.mjs" },
      interchange: {
        workflow: "./dist/workflow.mjs",
        directors: "./dist/workflow.mjs",
      },
    });
    // Interchange lends a package its creator's permissions only when it is stored as source, which
    // the coordinator's are; the bundle has no dependencies, so its two files are the whole package.
    if (name === "coordinator") {
      manifest.push({
        assetName: "sb-coordinator-source",
        packageName,
        version,
        entry: "./dist/workflow.mjs",
        files: { "package.json": packageJson, "dist/workflow.mjs": bundle },
      });
      continue;
    }
    const staging = await mkdtemp(join(tmpdir(), "sb-workflow-package-"));
    const filename = name + "-native-" + version + ".tgz";
    try {
      await mkdir(join(staging, "package", "dist"), { recursive: true });
      const builtEntry = join(staging, "package", "dist", "workflow.mjs");
      await writeFile(builtEntry, bundle);
      await writeFile(join(staging, "package", "package.json"), packageJson);
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
