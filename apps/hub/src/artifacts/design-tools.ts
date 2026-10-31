import { type } from "arktype";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import { designCheckFor } from "../builds/design-check.ts";
import { withDesignTokens } from "./design-tokens.ts";
import { DESIGN_STYLES } from "./design-tweaks.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson } from "../workflows/http-json.ts";
import { failure, HubArtifactReceipt } from "./tools.ts";

interface DesignToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

export const MAX_DESIGN_BYTES = 256 * 1024;

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

async function readDesignFolder(workspace: string) {
  const files: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: join(workspace, ".builder"),
  }))
    files[path] = await readFile(join(workspace, ".builder", path), "utf8");
  return files;
}

// Files the designer's .builder folder as its design concept's option. The person decides on the
// design once, by choosing among the filed options, never while a designer is still working.
export function createDesignTools() {
  const definitions = [
    {
      name: "file_design_option",
      description:
        "File the .builder folder (DESIGN.md and designs/) as the next version of your design concept's option. The person compares it with the other concepts' options and picks the one to build. The hub assigns its id, version and sha256 and returns them.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
  return defineTool<DesignToolEnv>({
    id: "@corbits-builder/artifacts/design-tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["toolCwd", "capabilities"],
    definitions: [{ name: "file_design_option" }],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        if (call.name !== "file_design_option")
          return {
            callId: call.id,
            content: "unknown_design_tool",
            isError: true,
          };
        try {
          const scope = await resolveWorkflowProjectScope(
            env.capabilities,
            "designer",
            signal,
          );
          const projectPath =
            "/api/tenants/" +
            encodeURIComponent(scope.tenantId) +
            "/projects/" +
            encodeURIComponent(scope.projectId);
          const hub = (path: string, body?: unknown) =>
            workflowHttpJson({
              capabilities: env.capabilities,
              handle: HUB_CREDENTIAL_HANDLE,
              path: projectPath + path,
              ...(body === undefined ? {} : { body }),
              maxResponseBytes: 16384,
              signal,
            });
          // The person reviews only a mockup that passed check-app as it is filed.
          const check = designCheckFor(await realpath(env.toolCwd));
          if (!check)
            return {
              callId: call.id,
              content:
                "design_unchecked: check-app has not run on the design yet",
              isError: true,
            };
          const checked = await check.current(signal);
          if (!checked.passed)
            return {
              callId: call.id,
              content: `design_check_failed: the design is filed once it passes check-app.\n${checked.checklist}`,
              isError: true,
            };
          const files = await readDesignFolder(env.toolCwd);
          const doc = files["DESIGN.md"];
          const styles = files[DESIGN_STYLES];
          if (doc === undefined || styles === undefined)
            return {
              callId: call.id,
              content: `invalid_design: .builder needs DESIGN.md and ${DESIGN_STYLES}`,
              isError: true,
            };
          try {
            files["DESIGN.md"] = withDesignTokens(doc, styles);
          } catch (error) {
            return {
              callId: call.id,
              content: `invalid_design: ${error instanceof Error ? error.message : String(error)}`,
              isError: true,
            };
          }
          const bundle = DesignBundle({ files });
          if (bundle instanceof type.errors)
            return {
              callId: call.id,
              content: "invalid_design: " + bundle.summary,
              isError: true,
            };
          const content = JSON.stringify(bundle);
          const bytes = Buffer.byteLength(content);
          if (bytes > MAX_DESIGN_BYTES)
            return {
              callId: call.id,
              content: `design_too_large: ${bytes} bytes; the limit is ${MAX_DESIGN_BYTES}`,
              isError: true,
            };
          const title = doc.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Design";
          const { artifact } = HubArtifactReceipt.assert(
            await hub("/artifacts", {
              kind: "design_option",
              title: title.slice(0, 512),
              content,
            }),
          );
          return { callId: call.id, content: JSON.stringify(artifact) };
        } catch (error) {
          return failure(call.id, error);
        }
      },
    }),
  });
}
