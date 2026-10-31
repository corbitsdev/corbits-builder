import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  ArtifactContent,
  ArtifactList,
  type DocumentWrite,
} from "@corbits-builder/schemas/artifact";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import {
  HubArtifactReceipt,
  resolveWorkflowProjectScope,
  workflowHttpJson,
} from "@corbits-builder/tools-hub";

const MAX_RESULT_BYTES = 300 * 1024;

// A deployed agent keeps the tool bundle it started with while the hub moves on; a field a newer
// hub adds must not fail every read of an older agent.
const HubArtifactList = ArtifactList.onDeepUndeclaredKey("ignore");
const HubArtifactContent = ArtifactContent.onDeepUndeclaredKey("ignore");

// A tool result holds at most 10000 characters (inference size-cap), and a cut document sends agents
// re-reading until the doom guard fails the run, so a long document is returned in parts that fit,
// escaped JSON and metadata included.
const PART_CHARS = 7000;

export async function projectArtifacts(
  capabilities: RuntimeCapabilities,
  role: WorkflowRole,
  signal: AbortSignal,
) {
  const scope = await resolveWorkflowProjectScope(capabilities, role, signal);
  const base =
    "/api/tenants/" +
    encodeURIComponent(scope.tenantId) +
    "/projects/" +
    encodeURIComponent(scope.projectId) +
    "/artifacts";
  const request = (path: string, body?: unknown) =>
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path,
      ...(body === undefined ? {} : { body }),
      maxResponseBytes: MAX_RESULT_BYTES,
      signal,
    });
  return {
    list: async () => HubArtifactList.assert(await request(base)),
    write: async (input: typeof DocumentWrite.infer) =>
      HubArtifactReceipt.assert(await request(base, input)),
    read: async (target: string, version?: number) => {
      const query = version === undefined ? "" : "?version=" + String(version);
      // The structured approaches repeat the document's prose for the person's side-by-side
      // view and would push a part past the tool-output cap.
      const { approaches: _, ...document } = HubArtifactContent.assert(
        await request(base + "/" + encodeURIComponent(target) + query),
      );
      return document;
    },
  };
}

export function documentPart<T extends { content: string }>(
  document: T,
  requested = 1,
) {
  const parts = Math.max(1, Math.ceil(document.content.length / PART_CHARS));
  if (parts === 1) return document;
  const part = Math.min(requested, parts);
  return {
    ...document,
    part,
    parts,
    content: document.content.slice((part - 1) * PART_CHARS, part * PART_CHARS),
  };
}
