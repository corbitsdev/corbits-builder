import { type } from "arktype";
import {
  defineTool,
  type AnnotatedToolFactory,
  type BaseEnv,
} from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { ToolResult } from "@intx/types/runtime";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { DocumentWrite } from "@corbits-builder/schemas/artifact";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { documentPart, projectArtifacts } from "./artifacts.ts";
import { readDefinition, ToolRead, writeDefinition } from "./definitions.ts";

interface ArtifactToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

export interface ArtifactToolDeps {
  failure: (callId: string, error: unknown) => ToolResult;
  unpackDesign?: (
    content: string,
    workspace: string,
  ) => Promise<Record<string, unknown>>;
}

export function createArtifactTools(
  role: WorkflowRole,
  { failure, unpackDesign }: ArtifactToolDeps,
): AnnotatedToolFactory<ArtifactToolEnv> {
  if (role === "coder" && unpackDesign === undefined)
    throw new Error("coder_artifact_tools_need_unpack_design");
  // A writer's or reviewer's task carries every document it needs in full; a read tool sends
  // writers looking for documents that do not exist.
  const definitions =
    role === "coordinator"
      ? [readDefinition, writeDefinition]
      : role === "writer"
        ? [writeDefinition]
        : [readDefinition];
  return defineTool<ArtifactToolEnv>({
    id: "@corbits-builder/artifacts/tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    // The coder's read of the design unpacks it into its workspace.
    requires: role === "coder" ? ["capabilities", "toolCwd"] : ["capabilities"],
    definitions: definitions.map(({ name }) => ({ name })),
    factory: (env) => {
      // Filing the same document again makes a new identical version each time until the doom
      // guard fails the run; say the earlier write already landed.
      const written = new Map<string, { body: string; version: number }>();
      return {
        definitions,
        run: async (call, signal) => {
          if (!definitions.some(({ name }) => name === call.name))
            return {
              callId: call.id,
              content: "unknown_artifact_tool",
              isError: true,
            };
          try {
            const artifacts = await projectArtifacts(
              env.capabilities,
              role,
              signal,
            );
            if (call.name === "write_artifact") {
              const input = DocumentWrite(call.arguments);
              if (input instanceof type.errors)
                return {
                  callId: call.id,
                  content: "invalid_arguments: " + input.summary,
                  isError: true,
                };
              // The coordinator's writers own every kind but the brief, so the documents the person
              // decides on come from them.
              if (role === "coordinator" && input.kind !== "problem_brief")
                return {
                  callId: call.id,
                  content: `brief_only: you write the problem brief; deploy_writer has a writer write the ${input.kind}`,
                  isError: true,
                };
              const body = JSON.stringify(input);
              const earlier = written.get(input.kind);
              if (earlier?.body === body)
                return {
                  callId: call.id,
                  content: `unchanged: version ${earlier.version} of this ${input.kind} already has exactly this content; the earlier write succeeded`,
                };
              const receipt = await artifacts.write(input);
              written.set(input.kind, {
                body,
                version: receipt.artifact.version,
              });
              return {
                callId: call.id,
                content: JSON.stringify(receipt.artifact),
              };
            }
            const input = ToolRead(call.arguments ?? {});
            if (input instanceof type.errors)
              return {
                callId: call.id,
                content: "invalid_arguments: " + input.summary,
                isError: true,
              };
            const target = input.kind ?? input.artifactId;
            if (target === undefined)
              return {
                callId: call.id,
                content: JSON.stringify(await artifacts.list()),
              };
            const document = await artifacts.read(target, input.version);
            const workspace =
              "toolCwd" in env && typeof env.toolCwd === "string"
                ? env.toolCwd
                : undefined;
            if (
              role === "coder" &&
              unpackDesign &&
              document.kind === "design" &&
              workspace
            ) {
              const files = await unpackDesign(document.content, workspace);
              // DESIGN.md runs past the host's tool-output cap, and a cut copy sends the coder
              // re-reading until the doom guard fails the run; read_file pages through it.
              return {
                callId: call.id,
                content: JSON.stringify({
                  ...document,
                  content: `Version ${document.version} of the design is unpacked, read-only, in .builder: ${Object.keys(files).join(", ")}. Read .builder/DESIGN.md with read_file.`,
                }),
              };
            }
            return {
              callId: call.id,
              content: JSON.stringify(documentPart(document, input.part)),
            };
          } catch (error) {
            return failure(call.id, error);
          }
        },
      };
    },
  });
}
