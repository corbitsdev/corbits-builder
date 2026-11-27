import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  DesignBundle,
  HubArtifactReceipt,
} from "@corbits-builder/schemas/artifact";
import { resolveWorkflowProjectScope } from "@corbits-builder/plugin/project-scope";
import { workflowHttpJson } from "@corbits-builder/plugin/http-json";

// Writes a bundle's files under root, skipping any path that would land outside it.
export async function writeBundle<T extends string | Uint8Array>(
  root: string,
  files: Readonly<Record<string, T>>,
) {
  const written: Record<string, T> = {};
  for (const [path, data] of Object.entries(files)) {
    const target = join(root, path);
    if (!target.startsWith(root + sep)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    written[path] = data;
  }
  return written;
}

// The coder builds against the design version its task names. It lands in .builder, which the
// coder's sandbox keeps read-only, so only the designer changes it.
export async function unpackDesign(content: string, workspace: string) {
  const { files } = DesignBundle.assert(JSON.parse(content));
  const root = join(workspace, ".builder");
  await rm(root, { recursive: true, force: true });
  return writeBundle(root, files);
}

// A design ready to file as an option: its bundle serialized, and the title its DESIGN.md gives it.
export type PreparedDesignSubmission = { content: string; title: string };

export async function fileDesignOption(
  capabilities: RuntimeCapabilities,
  role: string,
  submission: PreparedDesignSubmission,
  signal: AbortSignal,
) {
  const scope = await resolveWorkflowProjectScope(capabilities, role, signal);
  const projectPath =
    "/api/tenants/" +
    encodeURIComponent(scope.tenantId) +
    "/projects/" +
    encodeURIComponent(scope.projectId);
  return HubArtifactReceipt.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: projectPath + "/artifacts",
      body: {
        kind: "design_option",
        title: submission.title,
        content: submission.content,
      },
      maxResponseBytes: 16384,
      signal,
    }),
  );
}
