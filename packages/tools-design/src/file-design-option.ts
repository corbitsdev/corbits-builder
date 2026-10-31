import { type } from "arktype";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResult } from "@intx/types/runtime";
import {
  ArtifactReceipt,
  DesignBundle,
} from "@corbits-builder/schemas/artifact";
import { designCheckFor } from "./design-check.ts";
import { withDesignTokens } from "./design-tokens.ts";
import { DESIGN_STYLES } from "./design-tweaks.ts";

export const MAX_DESIGN_BYTES = 256 * 1024;

// A deployed agent keeps the tool bundle it started with while the hub moves on; a field a newer
// hub adds must not fail every filing of an older agent.
const HubArtifactReceipt = ArtifactReceipt.onDeepUndeclaredKey("ignore");

export const fileDesignOptionDefinition = {
  name: "file_design_option",
  description:
    "File the .builder folder (DESIGN.md and designs/) as the next version of your design concept's option. The person compares it with the other concepts' options and picks the one to build. The hub assigns its id, version and sha256 and returns them.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

async function readDesignFolder(workspace: string) {
  const files: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: join(workspace, ".builder"),
  }))
    files[path] = await readFile(join(workspace, ".builder", path), "utf8");
  return files;
}

// Files the workspace's .builder folder through postArtifact, the hub's artifacts route for the
// run's project.
export async function fileDesignOption(input: {
  callId: string;
  workspace: string;
  postArtifact: (body: unknown) => Promise<unknown>;
  signal: AbortSignal;
}): Promise<ToolResult> {
  const { callId, workspace, postArtifact, signal } = input;
  // The person reviews only a mockup that passed check-app as it is filed.
  const check = designCheckFor(await realpath(workspace));
  if (!check)
    return {
      callId,
      content: "design_unchecked: check-app has not run on the design yet",
      isError: true,
    };
  const checked = await check.current(signal);
  if (!checked.passed)
    return {
      callId,
      content: `design_check_failed: the design is filed once it passes check-app.\n${checked.checklist}`,
      isError: true,
    };
  const files = await readDesignFolder(workspace);
  const doc = files["DESIGN.md"];
  const styles = files[DESIGN_STYLES];
  if (doc === undefined || styles === undefined)
    return {
      callId,
      content: `invalid_design: .builder needs DESIGN.md and ${DESIGN_STYLES}`,
      isError: true,
    };
  try {
    files["DESIGN.md"] = withDesignTokens(doc, styles);
  } catch (error) {
    return {
      callId,
      content: `invalid_design: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
  const bundle = DesignBundle({ files });
  if (bundle instanceof type.errors)
    return {
      callId,
      content: "invalid_design: " + bundle.summary,
      isError: true,
    };
  const content = JSON.stringify(bundle);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_DESIGN_BYTES)
    return {
      callId,
      content: `design_too_large: ${bytes} bytes; the limit is ${MAX_DESIGN_BYTES}`,
      isError: true,
    };
  const title = doc.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Design";
  const { artifact } = HubArtifactReceipt.assert(
    await postArtifact({
      kind: "design_option",
      title: title.slice(0, 512),
      content,
    }),
  );
  return { callId, content: JSON.stringify(artifact) };
}
