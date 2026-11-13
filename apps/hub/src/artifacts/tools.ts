import { type } from "arktype";
import {
  defineTool,
  type AnnotatedToolFactory,
  type BaseEnv,
} from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  AnyDocumentFields,
  ArtifactContent,
  ArtifactList,
  ArtifactRead,
  ArtifactReceipt,
  WriterDocumentFields,
  type DocumentWrite,
  type WriterDocumentKind,
} from "@corbits-builder/schemas/artifact";
import { inShort } from "@corbits-builder/schemas/in-short";
import type { Role } from "@corbits-builder/plugin";
import { COORDINATOR } from "../workflows/coordinator-role.ts";
import { stripApprovalPackageBinaries } from "./approval-package.ts";
import { unpackDesign } from "./design-tools.ts";
import {
  projectScopeFailure,
  resolveWorkflowProjectScope,
} from "../workflows/project-scope.ts";
import {
  accessRefusal,
  workflowHttpJson,
  WorkflowHttpError,
} from "../workflows/http-json.ts";

interface ArtifactToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

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
    "See which project documents exist, or read one.\nWith no arguments it lists:\n- each document's artifactId, kind, title, current version, sha256, approvedVersion (the version a person approved) and openQuestionCount (the questions its current version leaves open for the person);\n- inFlight, the specialists' runs still open. Each has its status, deployed until its first assignment arrives and running after, and is working (mid-turn) or waiting (between turns). Once it has acted it has progress: its turns so far, its latest tool calls as tool and target, the files it has written, and lastActivityAt;\n- failed, the latest runs that stopped on an error, with when and why. They deliver nothing more;\n- awaitingApproval, the kinds of filed documents whose current version waits on the person's approval;\n- appBuilt, whether the project's code (the document of kind app) has had its first build: a version filed after a passing check or brought in by import;\n- preferenceGuidance, the person's standing settings for how they want to work. They apply until the person says otherwise: what they tell you in the conversation overrides a setting.\nWith a kind, as that list names it, or an artifactId it returns that document's content at its current version, or at the given version, with the openQuestions that version leaves for the person. A long document comes in numbered parts, and part reads the next one.",
  inputSchema: { ...ToolRead.toJsonSchema() },
};
// The person asked to approve a document decides from its summary on the card, so none is filed
// without one.
const IN_SHORT =
  "content opens with ## In short: two to four one-line bullets written for the person deciding whether to approve it, who may read nothing else: what it concludes, decides or leaves out, specific to this document, with no counts and nothing about the document itself.";

// Each writer's document by name, and what its write_artifact says about the fields only it has.
const WRITER_DOCUMENTS: Record<
  WriterDocumentKind,
  { name: string; fieldNotes: string[] }
> = {
  product_requirements: { name: "product requirements", fieldNotes: [] },
  build_plan: { name: "build plan", fieldNotes: [] },
};

function writerWriteDefinition(kind: WriterDocumentKind) {
  const { name, fieldNotes } = WRITER_DOCUMENTS[kind];
  return {
    name: "write_artifact",
    description: [
      `Write the next version of the ${name}. The hub assigns its id, version and sha256 and returns them. Writing a version is not approval.`,
      "openQuestions lists each question the document leaves for the person to answer, as its Open questions section asks them: a short id, the question as they would read it, whyItBlocks, and suggestedAnswers, your recommendation first. A version written without openQuestions leaves none open.",
      IN_SHORT,
      ...fieldNotes,
    ].join("\n"),
    inputSchema: { ...WriterDocumentFields[kind].toJsonSchema() },
  };
}

const documentWriteDefinition = {
  name: "write_artifact",
  description: [
    "Write the next version of the document your task names. kind is the kind your task names: a short lowercase slug such as competitor_analysis, the same for every version. title is its title, and content is the document itself as markdown sections. The hub assigns its id, version and sha256 and returns them. Writing a version is not approval.",
    "openQuestions lists each question the document leaves for the person to answer, as its Open questions section asks them: a short id, the question as they would read it, whyItBlocks, and suggestedAnswers, your recommendation first. A version written without openQuestions leaves none open.",
    IN_SHORT,
  ].join("\n"),
  inputSchema: { ...AnyDocumentFields.toJsonSchema() },
};

// A specialist saves what it learned of the project values its assignment lists; the hub keeps
// to the names the plugin action it was started for writes.
const ReportValues = type({ "[string]": "unknown" });
const reportValuesDefinition = {
  name: "report_values",
  description:
    'Save project values you learned while working, by name, such as { "stack.language": "TypeScript" }. Your assignment lists the values your work saves and what each holds; a name it does not list is refused and nothing is saved.',
  inputSchema: { ...ReportValues.toJsonSchema() },
};

// Why the hub saved none of the values, field by field, as the agent can correct it.
function valuesRefused(callId: string, error: WorkflowHttpError) {
  return {
    callId,
    content: [
      `Nothing was saved (${error.refusalCode ?? "refused"}).`,
      ...(error.issues ?? []).map(({ path, message }) => `${path}: ${message}`),
      ...(error.hint ? [error.hint] : []),
      "Call again with only the values your assignment lists, each of the type it names.",
    ].join("\n"),
    isError: true,
  };
}

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
      ...accessRefusal(error),
    };
  return projectScopeFailure(callId, error);
}

// The tools a role gets, and for a role that writes, the check of its fields that names the kind
// they file under.
interface ArtifactToolSet {
  definitions: readonly (typeof readDefinition)[];
  save?: (fields: unknown) => typeof DocumentWrite.infer | type.errors;
}

// A role deployed for one kind files its fields under that kind.
const savesAs =
  (
    kind: typeof DocumentWrite.infer.kind,
    check: (typeof WriterDocumentFields)[WriterDocumentKind],
  ) =>
  (raw: unknown) => {
    const fields = check(raw);
    return fields instanceof type.errors ? fields : { ...fields, kind };
  };

// A role's artifact tools, as its tools name them: reading the project's documents, and with
// write_artifact filing a document of any kind, saved under the kind it names.
export const createArtifactTools = (role: Role) =>
  artifactTools(
    role,
    role.tools.includes("write_artifact")
      ? {
          definitions: [documentWriteDefinition, readDefinition],
          save: AnyDocumentFields,
        }
      : { definitions: [readDefinition] },
  );

// The coordinator reads the project; specialists write every document.
export const createReadArtifactTools = () =>
  artifactTools(COORDINATOR, { definitions: [readDefinition] });

// A writer of a known kind is deployed for it and saves only that kind.
export function createWriterArtifactTools(
  role: Role,
  kind: WriterDocumentKind,
) {
  return artifactTools(role, {
    definitions: [writerWriteDefinition(kind), readDefinition],
    save: savesAs(kind, WriterDocumentFields[kind]),
  });
}

function artifactTools(
  role: Pick<Role, "name" | "writesCode">,
  { definitions: own, save }: ArtifactToolSet,
): AnnotatedToolFactory<ArtifactToolEnv> {
  // Every specialist may save the project values its plugin action writes.
  const definitions =
    role.name === COORDINATOR.name ? own : [...own, reportValuesDefinition];
  return defineTool<ArtifactToolEnv>({
    id: "@corbits-builder/artifacts/tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    // A code writer's read of the design unpacks it into its workspace.
    requires: role.writesCode ? ["capabilities", "toolCwd"] : ["capabilities"],
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
              role.name,
              signal,
            );
            const projectPath =
              "/api/tenants/" +
              encodeURIComponent(scope.tenantId) +
              "/projects/" +
              encodeURIComponent(scope.projectId);
            const base = projectPath + "/artifacts";
            const request = (path: string, body?: unknown) =>
              workflowHttpJson({
                capabilities: env.capabilities,
                handle: HUB_CREDENTIAL_HANDLE,
                path,
                ...(body === undefined ? {} : { body }),
                // A document is as large as it is; the parts below keep the model's read small.
                maxResponseBytes: Number.POSITIVE_INFINITY,
                signal,
              });
            if (call.name === "report_values") {
              const values = ReportValues(call.arguments);
              if (values instanceof type.errors)
                return {
                  callId: call.id,
                  content: `Nothing was saved: pass the values as { name: value }, such as { "stack.language": "TypeScript" }; ${values.summary}`,
                  isError: true,
                };
              try {
                return {
                  callId: call.id,
                  content: JSON.stringify(
                    await request(projectPath + "/run-values", { values }),
                  ),
                };
              } catch (error) {
                if (
                  error instanceof WorkflowHttpError &&
                  (error.status === 400 ||
                    (error.status === 403 && error.refusalCode !== "forbidden"))
                )
                  return valuesRefused(call.id, error);
                throw error;
              }
            }
            if (call.name === "write_artifact" && save) {
              const input = save(call.arguments);
              if (input instanceof type.errors)
                return {
                  callId: call.id,
                  content: "invalid_arguments: " + input.summary,
                  isError: true,
                };
              if (inShort(input.content) === undefined)
                return {
                  callId: call.id,
                  content: `not_filed: nothing was filed, as the document has no summary. A document's ${IN_SHORT} Call write_artifact again with it.`,
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
            if (role.writesCode && document.kind === "design" && workspace) {
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
            const prepared =
              document.kind === "approval_package"
                ? {
                    ...document,
                    content: stripApprovalPackageBinaries(document.content),
                  }
                : document;
            const parts = Math.max(
              1,
              Math.ceil(prepared.content.length / PART_CHARS),
            );
            const part = Math.min(input.part ?? 1, parts);
            if (parts === 1)
              return { callId: call.id, content: JSON.stringify(prepared) };
            return {
              callId: call.id,
              content: JSON.stringify({
                ...prepared,
                part,
                parts,
                content: prepared.content.slice(
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
