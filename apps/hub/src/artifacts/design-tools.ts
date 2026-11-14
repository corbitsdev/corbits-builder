import { type } from "arktype";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import {
  designCheckFor,
  registerDesignFiler,
  type FiledDesignArtifact,
} from "../builds/design-check.ts";
import { designSize, readDesignFiles } from "./design-draft.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson } from "../workflows/http-json.ts";
import { failure, HubArtifactReceipt } from "./tools.ts";

interface DesignToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

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
    factory: (env) => {
      let lastFiled:
        | { content: string; artifact: FiledDesignArtifact }
        | undefined;
      const fileOption = async (
        signal: AbortSignal,
      ): Promise<FiledDesignArtifact> => {
        const files = await readDesignFiles(env.toolCwd);
        const bundle = DesignBundle({ files });
        if (bundle instanceof type.errors)
          throw new Error("invalid_design: " + bundle.summary);
        const content = JSON.stringify(bundle);
        const size = designSize(files, content);
        if (size.over) throw new Error("design_too_large: " + size.hint);
        if (lastFiled?.content === content) return lastFiled.artifact;
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
        const title =
          files["DESIGN.md"]!.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Design";
        const { artifact } = HubArtifactReceipt.assert(
          await workflowHttpJson({
            capabilities: env.capabilities,
            handle: HUB_CREDENTIAL_HANDLE,
            path: projectPath + "/artifacts",
            body: {
              kind: "design_option",
              title: title.slice(0, 512),
              content,
            },
            maxResponseBytes: 16384,
            signal,
          }),
        );
        lastFiled = { content, artifact };
        return artifact;
      };
      registerDesignFiler(env.toolCwd, fileOption);
      return {
        definitions,
        run: async (call, signal) => {
          if (call.name !== "file_design_option")
            return {
              callId: call.id,
              content: "unknown_design_tool",
              isError: true,
            };
          try {
            const workspace = await realpath(env.toolCwd);
            registerDesignFiler(workspace, fileOption);
            // The person reviews only a mockup that passed check-app as it is filed.
            const check = designCheckFor(workspace);
            if (!check)
              return {
                callId: call.id,
                content:
                  "design_unchecked: check-app has not run on the design yet",
                isError: true,
              };
            const checked = await check.current(signal);
            if (!checked.passed) {
              if (checked.filingError !== undefined) {
                if (
                  checked.filingError instanceof Error &&
                  /^(?:invalid_design|design_too_large):/.test(
                    checked.filingError.message,
                  )
                )
                  return {
                    callId: call.id,
                    content: checked.filingError.message,
                    isError: true,
                  };
                return failure(call.id, checked.filingError);
              }
              return {
                callId: call.id,
                content: `design_check_failed: the design is filed once it passes check-app.\n${checked.checklist}`,
                isError: true,
              };
            }
            const artifact = checked.artifact ?? (await fileOption(signal));
            return { callId: call.id, content: JSON.stringify(artifact) };
          } catch (error) {
            if (
              error instanceof Error &&
              /^(?:invalid_design|design_too_large):/.test(error.message)
            )
              return {
                callId: call.id,
                content: error.message,
                isError: true,
              };
            return failure(call.id, error);
          }
        },
      };
    },
  });
}
