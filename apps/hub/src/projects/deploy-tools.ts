import { defineTool, type AnnotatedToolFactory } from "@intx/agent/authoring";
import { questionTool } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { type } from "arktype";
import { Instruction } from "@corbits-builder/plugin";
import { NativeDocumentKind } from "@corbits-builder/schemas/native-specialist";
import { WRITER_PACKAGES } from "@corbits-builder/schemas/installed-workflows";
import {
  ArtifactContent,
  DesignBundle,
  DesignConcept,
  WriterDocumentKind,
} from "@corbits-builder/schemas/artifact";
import { Preferences } from "@corbits-builder/schemas/preferences";
import { DEFAULT_STACK } from "../config/packages.ts";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  DESIGNER_INPUTS,
  startHere,
} from "../config/inputs.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import { DESIGN_CONCEPTS, DESIGN_THEMES } from "../config/design.ts";
import {
  buildPackageAssignment,
  formatPersonasCatalog,
  presenterAssignmentMessage,
  type PresenterDesignTokens,
} from "../config/personas.ts";
import { DESIGN_STYLES } from "../artifacts/design-tweaks.ts";
import { checkPluginQuestion } from "../plugins/question.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";
import { assignmentToWriterMessage } from "../workflows/writer-task.ts";
import { coderTaskMessage } from "@corbits-builder/coder/contract";
import {
  APPROVABLE,
  checkDeployments,
  projectSession,
  Refusal,
  refusalText,
  RequestApproval,
  REQUEST_APPROVAL_DESCRIPTION,
  resolveProjectOptions,
  validArguments,
  type DeployEnv,
  type ProjectListing,
  type ProjectOptions,
} from "./project-session.ts";

export const DEPLOY_TOOLS = "@corbits-builder/deploy/tools";
const CODER_DOCUMENTS = [...CODER_INPUTS, "design"] as const;
const DeployWriter = type({
  "+": "reject",
  kind: WriterDocumentKind,
  instruction: Instruction,
});
// The documents in the order each builds on the ones before it; the build plan follows the design.
const DOCUMENT_ORDER = [
  ...APPROVABLE.slice(0, 4),
  "design",
  "build_plan",
] as const;

/** The filed documents waiting on the person's request_approval at their current version. */
export function awaitingApproval<
  T extends { kind: string; version: number; approvedVersion?: number },
>(filed: readonly T[], preferences: Preferences): T[] {
  if (agentDecidesApprovals(preferences)) return [];
  return filed.filter(
    (item) =>
      (APPROVABLE as readonly string[]).includes(item.kind) &&
      item.approvedVersion !== item.version,
  );
}

const ReviewArtifact = type({
  "+": "reject",
  kind: NativeDocumentKind.or("'problem_brief'"),
  instruction: Instruction,
});
const DeployCoder = type({ "+": "reject", "instruction?": Instruction });
const InstructCoder = type({ "+": "reject", instruction: Instruction });
const DesignApp = type({
  "+": "reject",
  instruction: Instruction,
  lookIdeas: "string > 0",
  concepts: DesignConcept.array().atLeastLength(1).atMostLength(5),
});
const DeployPresenter = type({
  "+": "reject",
  audience: "string > 0",
  decisionNeeded: "string > 0",
  kinds: type
    .enumerated(...APPROVABLE)
    .array()
    .atLeastLength(1),
  tone: "string > 0",
  length: "string > 0",
  instruction: Instruction,
});

const notApproved = (kind: string, version: number) =>
  new Refusal(
    kind +
      "_not_approved: a person has not approved " +
      kind +
      " version " +
      String(version) +
      (kind === "design"
        ? "; they approve a design by confirming a design option in the conversation"
        : "; ask them with request_approval"),
  );

// The classic coordinator's staged tools, each gated on the documents before it.
export function createDeployTools(
  options?: ProjectOptions,
): AnnotatedToolFactory<DeployEnv> {
  if (options) checkDeployments(options.workflows);
  const definitions = [
    {
      name: "request_approval",
      description: REQUEST_APPROVAL_DESCRIPTION,
      inputSchema: { ...RequestApproval.toJsonSchema() },
    },
    questionTool,
    {
      name: "deploy_writer",
      description:
        "Have a writer write one document of the given kind from the filed documents. instruction says what the document must cover or correct; the writer sees only the filed documents and the instruction, so put in it anything the person said that the documents do not record. A writer starts once each earlier document is filed and a person approved its current version. A document can be rewritten at any time. The finished document arrives later as a message.",
      inputSchema: { ...DeployWriter.toJsonSchema() },
    },
    {
      name: "review_artifact",
      description:
        "Ask a reviewer for a second opinion on the filed document of the given kind, checked against the problem brief. instruction says what to check. The review arrives later as a message; it is advice for you to weigh, and approval stays with the person.",
      inputSchema: { ...ReviewArtifact.toJsonSchema() },
    },
    {
      name: "deploy_coder",
      description:
        "Have the coder build the whole app from the filed problem brief, constraints, approaches, product requirements, build plan and design. The documents are the assignment; an optional instruction adds a note to it. It starts once a person approved the current version of each document: the design by confirming a design option in the conversation, the others through request_approval. This is the first build only; once a version is filed after a passing check, changes go through instruct_coder.",
      inputSchema: { ...DeployCoder.toJsonSchema() },
    },
    {
      name: "instruct_coder",
      description:
        "Have a fresh coder make one change to the built app: a fix, an addition or a correction. It starts from the app as last saved, once the coder before it has replied. A person approves every instruction.",
      inputSchema: { ...InstructCoder.toJsonSchema() },
    },
    {
      name: "design_app",
      description:
        "Have the designer make or change the app's design from the filed problem brief, constraints, approaches and product requirements: a clickable, responsive mockup with a DESIGN.md of its tokens, screens, states and flows. The coder builds only from a filed design. instruction says what to design or change. lookIdeas carries the person's own ideas for the look in their words, or that they left the look to you, and every designer works from it. The designer starts once a person approves the instruction. Each design arrives later as a message.\n\nWhen the person wants one suggested design, give one concept: the look you suggest, shaped by their ideas. When they want to explore several, give a concept for each look: as many as the person asked for, or the number their Design concepts preference names when they said no number. What they say in the conversation wins over that preference. At most five concepts can be at work at a time, counting designers already started. One designer per concept makes the design in that concept's look and files it as that concept's design_option for the person to compare. A concept designed before gets a fresh designer that changes its latest draft, once the designer before it has replied. Choose concepts that differ clearly from one another, from this catalog or of your own that fit the idea better. Each catalog concept starts from a design theme (" +
        DESIGN_THEMES.map((theme) => theme.label).join(", ") +
        ") and its direction says how its designer adjusts that theme's tokens; a concept of your own starts from the kit's neutral theme, so its direction names the colours, type and radii it wants. When the person chose a theme, design that one concept, with the changes they asked for in its direction:\n" +
        DESIGN_CONCEPTS.map(
          ({ label, direction }) => "- " + label + ": " + direction,
        ).join("\n"),
      inputSchema: { ...DesignApp.toJsonSchema() },
    },
    {
      name: "deploy_presenter",
      description:
        "Have a presenter build a slide deck (.pptx and .pdf) and file an approval package for a specific audience from the selected approved documents and the project's filed design tokens. Interview the person first with the question tool on the audience persona, decision needed, documents to include, and tone and length. Each selected document must be filed and approved at its current version. When a design is filed, its tokens are included and pinned automatically.\n\nStarting audience personas:\n" +
        formatPersonasCatalog(),
      inputSchema: { ...DeployPresenter.toJsonSchema() },
    },
  ];
  return defineTool<DeployEnv>({
    id: DEPLOY_TOOLS,
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [
      { name: "request_approval", approval: "ask" },
      { name: "deploy_writer" },
      { name: "review_artifact" },
      { name: "deploy_coder" },
      { name: "instruct_coder", approval: "ask" },
      { name: "design_app", approval: "ask" },
      { name: "deploy_presenter" },
    ],
    factory: (env) => ({
      definitions,
      checkQuestion: (question) =>
        checkPluginQuestion(question, env.capabilities, options),
      run: async (call, signal) => {
        if (!options) {
          try {
            return createDeployTools(
              await resolveProjectOptions(env.capabilities, signal),
            )(env).run(call, signal);
          } catch (error) {
            return projectScopeFailure(call.id, error);
          }
        }
        const {
          projectPath,
          hub,
          listed,
          readSource,
          recordApproval,
          notFiled,
          required,
          inputs,
          deploy,
          approve,
          startCoder,
          startDesigners,
        } = projectSession(env, options, signal);
        const refsOf = (byKind: ProjectListing["byKind"]) =>
          [...byKind].map(([kind, ref]) => ({ kind, ...ref }));
        type Listed = ProjectListing;
        /*
         * Each start tool refuses with its gate's answer, and an approval reports the steps whose
         * gates then pass. The coordinator learns what it may start from the rule that enforces it,
         * so loosening a gate loosens what it is told.
         */
        const writerGate = (
          { byKind, approved, preferences }: Listed,
          kind: (typeof DOCUMENT_ORDER)[number],
        ): Refusal | undefined => {
          if (!byKind.has("problem_brief")) return notFiled("problem_brief");
          const earlier = DOCUMENT_ORDER.slice(0, DOCUMENT_ORDER.indexOf(kind));
          // An imported project may lack an earlier document that its later ones were written without.
          const writtenWithout = (index: number) =>
            DOCUMENT_ORDER.slice(index + 1).some((later) => byKind.has(later));
          for (const [index, before] of earlier.entries()) {
            const ref = byKind.get(before);
            if (!ref) {
              if (writtenWithout(index)) continue;
              return new Refusal(
                before +
                  "_missing: " +
                  (before === "design"
                    ? "have the designer make it with design_app"
                    : "write and file the " + before) +
                  " before the " +
                  kind,
              );
            }
            if (
              !agentDecidesApprovals(preferences) &&
              approved.get(before) !== ref.version
            )
              return notApproved(before, ref.version);
          }
          return undefined;
        };
        const designGate = ({ byKind }: Listed) => {
          const missing = DESIGNER_INPUTS.find((kind) => !byKind.has(kind));
          return missing === undefined ? undefined : notFiled(missing);
        };
        const coderGate = ({ byKind, approved, preferences }: Listed) => {
          const missing = CODER_DOCUMENTS.find((kind) => !byKind.has(kind));
          if (missing !== undefined) return notFiled(missing);
          for (const kind of DOCUMENT_ORDER) {
            const ref = byKind.get(kind);
            if (!ref) return notFiled(kind);
            // The design is approved by choosing it, whoever decides the other documents.
            if (
              (kind === "design" || !agentDecidesApprovals(preferences)) &&
              approved.get(kind) !== ref.version
            )
              return notApproved(kind, ref.version);
          }
          return undefined;
        };
        // A step already made or under way is not offered again, whatever its gate says.
        const startable = (state: Listed) => {
          const busy = new Set(state.inFlight.map((run) => run.role));
          const open = (
            made: boolean,
            role: string,
            gate: Refusal | undefined,
          ) => !made && !busy.has(role) && gate === undefined;
          return [
            ...DOCUMENT_ORDER.filter(
              (kind) =>
                kind in WRITER_PACKAGES &&
                open(state.byKind.has(kind), "writer", writerGate(state, kind)),
            ),
            ...(!state.designOptions &&
            open(state.byKind.has("design"), "designer", designGate(state))
              ? ["design"]
              : []),
            ...(open(state.appBuilt, "coder", coderGate(state)) ? ["app"] : []),
          ];
        };
        const coderPreamble = (byKind: Listed["byKind"], note = "") =>
          startHere(
            inputs(CODER_INPUTS, byKind),
            required(byKind, "design").version,
          ) + note;
        try {
          signal.throwIfAborted();
          let result: unknown;
          let canStart: readonly string[] = [];
          if (call.name === "request_approval") {
            const { kinds } = validArguments(RequestApproval, call.arguments);
            const { state, documents } = await approve(kinds);
            canStart = startable(state);
            result = { approved: documents, canStart };
          } else if (call.name === "deploy_writer") {
            const input = validArguments(DeployWriter, call.arguments);
            const state = await listed();
            const { byKind, preferences } = state;
            const refusal = writerGate(state, input.kind);
            if (refusal) throw refusal;
            const briefRef = required(byKind, "problem_brief");
            const target = byKind.get(input.kind);
            const sourceRefs = [...byKind]
              .filter(
                ([kind]) =>
                  !["problem_brief", "app", input.kind].includes(kind) &&
                  (kind !== "design" || input.kind === "build_plan"),
              )
              .map(([, ref]) => ref);
            result = await deploy(
              "writer",
              options.workflows[WRITER_PACKAGES[input.kind]],
              preferences,
              "writer-" + input.kind,
              await assignmentToWriterMessage(
                {
                  projectId: options.projectId,
                  deliverableId: input.kind,
                  kind: input.kind,
                  briefRef,
                  sourceRefs,
                  output: { expectedVersion: target?.version ?? 0 },
                  instruction:
                    input.kind === "build_plan"
                      ? input.instruction +
                        "\n\nDefault stack unless the person asked otherwise: " +
                        DEFAULT_STACK
                      : input.instruction,
                },
                readSource,
                target,
              ),
            );
          } else if (call.name === "review_artifact") {
            const input = validArguments(ReviewArtifact, call.arguments);
            const { byKind, preferences } = await listed();
            const briefRef = required(byKind, "problem_brief");
            const target = required(byKind, input.kind);
            result = await deploy(
              "reviewer",
              options.workflows.reviewer,
              preferences,
              "reviewer-" + input.kind,
              await assignmentToWriterMessage(
                {
                  projectId: options.projectId,
                  deliverableId: input.kind,
                  kind: "engineering_review",
                  briefRef,
                  sourceRefs: [target],
                  output: { expectedVersion: target.version },
                  instruction: input.instruction,
                },
                readSource,
              ),
            );
          } else if (call.name === "deploy_coder") {
            const input = validArguments(DeployCoder, call.arguments);
            result = await startCoder("coder", (state) => {
              const refusal = coderGate(state);
              if (refusal) throw refusal;
              if (state.appBuilt)
                throw new Refusal(
                  "app_already_built: the app's first build is done; send changes with instruct_coder",
                );
              return (
                coderPreamble(state.byKind) +
                coderTaskMessage(input.instruction)
              );
            });
          } else if (call.name === "instruct_coder") {
            const input = validArguments(InstructCoder, call.arguments);
            result = await startCoder("coder-" + call.id, async (state) => {
              const { byKind } = state;
              for (const kind of CODER_DOCUMENTS) required(byKind, kind);
              // The first build's documents need their own approvals, which deploy_coder checks; an
              // approved change is no approval of them.
              if (!state.appBuilt)
                throw new Refusal(
                  "app_not_built: the app's first build is not done, so start or continue it with deploy_coder, which needs no approval",
                );
              await recordApproval("instruct_coder", refsOf(byKind));
              return (
                coderPreamble(byKind, APP_CHANGE_NOTE) +
                coderTaskMessage(input.instruction)
              );
            });
          } else if (call.name === "design_app") {
            const input = validArguments(DesignApp, call.arguments);
            result = await startDesigners(input, (state) => {
              const refusal = designGate(state);
              if (refusal) throw refusal;
              return startHere(inputs(DESIGNER_INPUTS, state.byKind));
            });
          } else if (call.name === "deploy_presenter") {
            const input = validArguments(DeployPresenter, call.arguments);
            const { byKind, approved, preferences } = await listed();
            const selectedKinds = [...new Set(input.kinds)];
            for (const kind of selectedKinds) {
              const ref = required(byKind, kind);
              if (
                !agentDecidesApprovals(preferences) &&
                approved.get(kind) !== ref.version
              )
                throw notApproved(kind, ref.version);
            }
            const documents = await Promise.all(
              selectedKinds.map(async (kind) => {
                const ref = required(byKind, kind);
                const loaded = await readSource(ref);
                return {
                  artifactId: ref.artifactId,
                  kind,
                  title: loaded.title,
                  version: ref.version,
                  sha256: ref.sha256,
                  content: loaded.content,
                };
              }),
            );
            const designRef = byKind.get("design");
            let design: PresenterDesignTokens | undefined;
            if (designRef) {
              if (approved.get("design") !== designRef.version)
                throw notApproved("design", designRef.version);
              const rawDesign = ArtifactContent.assert(
                await hub(
                  projectPath +
                    "/artifacts/" +
                    encodeURIComponent(designRef.artifactId) +
                    "?version=" +
                    String(designRef.version),
                ),
              );
              const { files } = DesignBundle.assert(
                JSON.parse(rawDesign.content),
              );
              const stylesCss = files[DESIGN_STYLES];
              design = {
                artifactId: designRef.artifactId,
                kind: "design",
                title: rawDesign.title,
                version: designRef.version,
                sha256: designRef.sha256,
                designMd: files["DESIGN.md"]!,
                ...(stylesCss ? { stylesCss } : {}),
              };
            }
            const assignmentPayload = {
              projectId: options.projectId,
              audience: input.audience,
              decisionNeeded: input.decisionNeeded,
              tone: input.tone,
              length: input.length,
              instruction: input.instruction,
              documents,
              ...(design ? { design } : {}),
            };
            const assignment = buildPackageAssignment(assignmentPayload);
            result = await deploy(
              "presenter",
              options.workflows.presenter,
              preferences,
              "presenter-" + input.audience,
              presenterAssignmentMessage(assignmentPayload),
              (runId) =>
                hub(projectPath + "/presenter-assignments", {
                  runId,
                  assignment,
                }),
            );
          } else
            return {
              callId: call.id,
              content: "unknown_deploy_tool",
              isError: true,
            };
          return {
            callId: call.id,
            content: JSON.stringify(result),
            ...(canStart.length ? { detail: { canStart } } : {}),
          };
        } catch (error) {
          return {
            callId: call.id,
            content: refusalText(error),
            isError: true,
          };
        }
      },
    }),
  });
}
