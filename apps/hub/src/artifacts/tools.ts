import { type } from "arktype";
import {
  defineTool,
  type AnnotatedToolFactory,
  type BaseEnv,
} from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  ArtifactContent,
  DocumentWrite,
  ArtifactList,
  ArtifactRead,
  ArtifactReceipt,
} from "@corbits-builder/schemas/artifact";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { unpackDesign } from "./design-bundle.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";
import {
  resolveWorkflowProjectScope,
  workflowHttpJson,
  WorkflowHttpError,
} from "@corbits-builder/tools-hub";

interface ArtifactToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

const MAX_RESULT_BYTES = 300 * 1024;

// A deployed agent keeps the tool bundle it started with while the hub moves on; a field a newer
// hub adds must not fail every read of an older agent.
export const HubArtifactList = ArtifactList.onDeepUndeclaredKey("ignore");
export const HubArtifactReceipt = ArtifactReceipt.onDeepUndeclaredKey("ignore");
const HubArtifactContent = ArtifactContent.onDeepUndeclaredKey("ignore");

// A tool result holds at most 10000 characters (inference size-cap), and a cut document sends agents
// re-reading until the doom guard fails the run, so a long document is returned in parts that fit,
// escaped JSON and metadata included.
const PART_CHARS = 7000;
const ToolRead = ArtifactRead.merge({ "part?": "number.integer > 0" });

const readDefinition = {
  name: "read_artifact",
  description:
    "See which project documents exist, or read one.\nWith no arguments it lists: each document's artifactId, kind, title, current version, sha256, approvedVersion, the version a person approved, and openQuestionCount, the questions its current version leaves open for the person; inFlight, the writer, reviewer, coder and designer runs still open, each with its status, deployed until its first assignment arrives and running after, and each working (mid-turn) or waiting (parked for your next mail), with progress once it has acted: its turns so far, its latest tool calls as tool and target, the files it has written, and lastActivityAt; failed, the latest runs that stopped on an error, with when and why, which deliver nothing more; awaitingApproval, the kinds of filed documents whose current version waits on the person's approval; and preferenceGuidance, how the person has said they want to work.\nWith a kind or an artifactId it returns that document's content at its current version, or at the given version, with the openQuestions that version leaves for the person; a long document comes in numbered parts, and part reads the next one.",
  inputSchema: { ...ToolRead.toJsonSchema() },
};
const writeDefinition = {
  name: "write_artifact",
  description:
    "Write the next version of the project document of one kind. The hub assigns its id, version and sha256 and returns them. Writing a version is not approval.\nopenQuestions lists each question in the document's Open questions section that the person must answer: a short id, the question as they would read it, whyItBlocks, and suggestedAnswers, your recommendation first. A version written without openQuestions leaves none open.\nOn the approaches document, approaches carries the approaches it compares, for the person to see side by side: each with a short id, its name, a one-line summary, bestFor, its pros, cons and risks as short phrases, and its effort; recommended names the id of the one you recommend.",
  inputSchema: { ...DocumentWrite.toJsonSchema() },
};

export function failure(callId: string, error: unknown) {
  if (error instanceof WorkflowHttpError && error.status)
    return {
      callId,
      content: JSON.stringify({
        code: error.refusalCode ?? "artifact_api_refused",
        status: error.status,
        ...(error.issues?.length ? { issues: error.issues } : {}),
        ...(error.hint ? { hint: error.hint } : {}),
      }),
      isError: true,
    };
  return projectScopeFailure(callId, error);
}

export function createArtifactTools(
  role: WorkflowRole,
): AnnotatedToolFactory<ArtifactToolEnv> {
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
          let target: string | undefined;
          if (!definitions.some(({ name }) => name === call.name))
            return {
              callId: call.id,
              content: "unknown_artifact_tool",
              isError: true,
            };
          try {
            const scope = await resolveWorkflowProjectScope(
              env.capabilities,
              role,
              signal,
            );
            const base =
              "/api/tenants/" +
              encodeURIComponent(scope.tenantId) +
              "/projects/" +
              encodeURIComponent(scope.projectId) +
              "/artifacts";
            const request = (path: string, body?: unknown) =>
              workflowHttpJson({
                capabilities: env.capabilities,
                handle: HUB_CREDENTIAL_HANDLE,
                path,
                ...(body === undefined ? {} : { body }),
                maxResponseBytes: MAX_RESULT_BYTES,
                signal,
              });
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
              const receipt = HubArtifactReceipt.assert(
                await request(base, input),
              );
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
            target = input.kind ?? input.artifactId;
            if (target === undefined)
              return {
                callId: call.id,
                content: JSON.stringify(
                  HubArtifactList.assert(await request(base)),
                ),
              };
            const query =
              input.version === undefined
                ? ""
                : "?version=" + String(input.version);
            // The structured approaches repeat the document's prose for the person's side-by-side
            // view and would push a part past the tool-output cap.
            const { approaches: _, ...document } = HubArtifactContent.assert(
              await request(base + "/" + encodeURIComponent(target) + query),
            );
            const workspace =
              "toolCwd" in env && typeof env.toolCwd === "string"
                ? env.toolCwd
                : undefined;
            if (role === "coder" && document.kind === "design" && workspace) {
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
            const parts = Math.max(
              1,
              Math.ceil(document.content.length / PART_CHARS),
            );
            const part = Math.min(input.part ?? 1, parts);
            if (parts === 1)
              return { callId: call.id, content: JSON.stringify(document) };
            return {
              callId: call.id,
              content: JSON.stringify({
                ...document,
                part,
                parts,
                content: document.content.slice(
                  (part - 1) * PART_CHARS,
                  part * PART_CHARS,
                ),
              }),
            };
          } catch (error) {
            return failure(call.id, error);
          }
        },
      };
    },
  });
}
