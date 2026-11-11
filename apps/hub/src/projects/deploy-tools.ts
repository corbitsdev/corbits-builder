import {
  projectScopeFailure,
  resolveWorkflowProjectScope,
} from "../workflows/project-scope.ts";
import {
  defineTool,
  type BaseEnv,
  type AnnotatedToolFactory,
} from "@intx/agent/authoring";
import { WorkflowDeploymentResponse } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { deriveRunAddress } from "@intx/workflow-deploy";
import { setTimeout as sleep } from "node:timers/promises";
import { type, TraversalError } from "arktype";
import {
  NativeDocumentKind,
  NativeSpecialistAssignment,
  NativeSpecialistDeployment,
} from "@corbits-builder/schemas/native-specialist";
import { SourceRef } from "@corbits-builder/schemas";
import {
  WRITER_PACKAGES,
  type WorkflowProjectScope,
} from "@corbits-builder/schemas/installed-workflows";
import {
  ArtifactContent,
  DesignBundle,
  DesignConcept,
  MATERIAL_KIND,
  WriterDocumentKind,
  type ArtifactRef,
} from "@corbits-builder/schemas/artifact";
import { Preferences } from "@corbits-builder/schemas/preferences";
import {
  AskQuestions,
  askQuestionsIssue,
} from "@corbits-builder/schemas/questions";
import { DEFAULT_STACK } from "../config/packages.ts";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  DESIGNER_INPUTS,
  startHere,
  type InputKind,
} from "../config/inputs.ts";
import {
  agentDecidesApprovals,
  asksOpenQuestions,
  designConceptCeiling,
  preferenceBlock,
} from "../config/preferences.ts";
import {
  DESIGN_CONCEPTS,
  DESIGN_THEMES,
  designConceptAssignment,
  designLookIdeas,
} from "../config/design.ts";
import { QUESTIONS_ASKED } from "../config/questions.ts";
import {
  buildPackageAssignment,
  formatPersonasCatalog,
  presenterAssignmentMessage,
  type PresenterDesignTokens,
} from "../config/personas.ts";
import { DESIGN_STYLES } from "../artifacts/design-tweaks.ts";
import { workflowHttpJson, WorkflowHttpError } from "../workflows/http-json.ts";
import { assignmentToWriterMessage } from "../workflows/writer-task.ts";
import { coderTaskMessage } from "@corbits-builder/coder/contract";

export const DEPLOY_TOOLS = "@corbits-builder/deploy/tools";
const CODER_DOCUMENTS = [...CODER_INPUTS, "design"] as const;
// A placeholder instruction repeated across turns ends the coordinator in a doom loop; a length
// floor the schema states gives it a refusal to act on instead.
const Instruction =
  NativeSpecialistAssignment.get("instruction").and("string >= 40");
const DeployWriter = type({
  "+": "reject",
  kind: WriterDocumentKind,
  instruction: Instruction,
});
const APPROVABLE = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;
// The documents in the order each builds on the ones before it; the build plan follows the design.
const DOCUMENT_ORDER = [
  ...APPROVABLE.slice(0, 4),
  "design",
  "build_plan",
] as const;
const RequestApproval = type({
  "+": "reject",
  kinds: type
    .enumerated(...APPROVABLE, MATERIAL_KIND)
    .array()
    .atLeastLength(1),
});

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
const ArtifactList = type({
  "+": "ignore",
  artifacts: type({
    "+": "ignore",
    kind: "string > 0",
    artifactId: "string > 0",
    title: "string > 0",
    version: "number.integer > 0",
    sha256: /^[a-f0-9]{64}$/,
    "approvedVersion?": "number.integer > 0",
    "openQuestionCount?": "number.integer > 0",
  }).array(),
  inFlight: type({
    "+": "ignore",
    runId: "string > 0",
    role: "string > 0",
    status: "'deployed' | 'running'",
    state: "'working' | 'waiting' | 'approval'",
    "concept?": "string > 0",
  }).array(),
  appBuilt: "boolean",
  preferences: Preferences,
});
type Ref = typeof SourceRef.infer;

interface DeployEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

class Refusal extends Error {}

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

// The deployments route answers only after it installs, probes and gates the source, each stage
// under its own native deadline: sidecar ensure and connection 120s each, the probe 60s. A shorter
// client deadline abandons a deploy the hub still completes.
const DEPLOY_TIMEOUT_MS = 300_000;
// How long a start waits for a replied run of the same work to end; see ended below.
const TEARDOWN_WAIT_MS = 30_000;
const TEARDOWN_POLL_MS = 1_000;

// A turn's tool calls run concurrently (INFERENCE.md "Parallel execution"), so two starts of the
// coder, or of one concept's designer, in the same turn would both find it missing from inFlight.
const starting = new Set<string>();
async function startOnce<T>(
  key: string,
  role: string,
  start: () => Promise<T>,
): Promise<T> {
  if (starting.has(key))
    throw new Refusal(
      role + "_starting: a " + role + " is already starting for this project",
    );
  starting.add(key);
  try {
    return await start();
  } finally {
    starting.delete(key);
  }
}

function validArguments<T>(
  schema: { assert: (value: unknown) => T },
  value: unknown,
): T {
  try {
    return schema.assert(value);
  } catch (error) {
    if (error instanceof TraversalError)
      throw new Refusal("invalid_arguments: " + error.message);
    throw error;
  }
}

// Authorization refusals stay a bare code; any other hub refusal carries the
// code with its field issues so the model can correct the call.
function hubRefusal(error: WorkflowHttpError): string {
  const code = error.refusalCode ?? error.message;
  if (error.status === 401 || error.status === 403 || !error.issues?.length)
    return code;
  return (
    code +
    ": " +
    error.issues.map((issue) => issue.path + " " + issue.message).join("; ")
  );
}

const refusalText = (error: unknown) =>
  error instanceof Refusal
    ? error.message
    : error instanceof WorkflowHttpError
      ? hubRefusal(error)
      : error instanceof Error
        ? error.name + ": " + error.message
        : String(error);

export function createDeployTools(options?: {
  tenantId: string;
  projectId: string;
  domain: string;
  workflows: WorkflowProjectScope["workflows"];
  maxResultBytes: number;
}): AnnotatedToolFactory<DeployEnv> {
  if (options) {
    for (const deployment of Object.values(options.workflows)) {
      if (!deployment) continue;
      const checked = NativeSpecialistDeployment.assert(deployment);
      if (!checked.sourceOfferingIds.includes(checked.defaultSourceOfferingId))
        throw new Error("invalid_specialist_default_offering");
    }
  }
  const definitions = [
    {
      name: "request_approval",
      description:
        "Ask the person to approve the filed documents of the given kinds, each at its current version; for material, every attached or imported material. One ask covers every document ready for the person, so list them all together, an earlier document with the ones that follow it. Ask for approval once the documents have no open questions left; open questions the person must decide go to them with ask_questions first. Their approval is what lets the writer of the next document start from them, and a changed document is approved again.",
      inputSchema: { ...RequestApproval.toJsonSchema() },
    },
    {
      name: "ask_questions",
      description:
        "Put up to five questions to the person on one card shown below your reply; your reply introduces them without repeating them. id is a short slug unique within the call. kind single takes one option and multi any number. preselected holds the option values you recommend, at most one for single. allowOther lets the person answer in their own words. Their answers arrive as their next message.",
      inputSchema: { ...AskQuestions.toJsonSchema() },
    },
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
        "Have a presenter build a slide deck (.pptx and .pdf) and file an approval package for a specific audience from the selected approved documents and the project's filed design tokens. Interview the person first with ask_questions on the audience persona, decision needed, documents to include, and tone and length. Each selected document must be filed and approved at its current version. When a design is filed, its tokens are included and pinned automatically.\n\nStarting audience personas:\n" +
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
      { name: "ask_questions" },
      { name: "deploy_writer" },
      { name: "review_artifact" },
      { name: "deploy_coder" },
      { name: "instruct_coder", approval: "ask" },
      { name: "design_app", approval: "ask" },
      { name: "deploy_presenter" },
    ],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        if (call.name === "ask_questions") {
          try {
            const issue = askQuestionsIssue(
              validArguments(AskQuestions, call.arguments),
            );
            if (issue) throw new Refusal("invalid_questions: " + issue);
            return { callId: call.id, content: QUESTIONS_ASKED };
          } catch (error) {
            return {
              callId: call.id,
              content: refusalText(error),
              isError: true,
            };
          }
        }
        if (!options) {
          try {
            const scope = await resolveWorkflowProjectScope(
              env.capabilities,
              "coordinator",
              signal,
            );
            return createDeployTools({
              tenantId: scope.tenantId,
              projectId: scope.projectId,
              domain: scope.domain,
              workflows: scope.workflows,
              maxResultBytes: 300 * 1024,
            })(env).run(call, signal);
          } catch (error) {
            return projectScopeFailure(call.id, error);
          }
        }
        const projectPath =
          "/api/tenants/" +
          encodeURIComponent(options.tenantId) +
          "/projects/" +
          encodeURIComponent(options.projectId);
        const hub = (path: string, body?: unknown, timeoutMs?: number) =>
          workflowHttpJson({
            capabilities: env.capabilities,
            handle: HUB_CREDENTIAL_HANDLE,
            path,
            ...(body === undefined ? {} : { body }),
            maxResponseBytes: options.maxResultBytes,
            signal,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          });
        const listed = async () => {
          const list = ArtifactList.assert(
            await hub(projectPath + "/artifacts"),
          );
          const byKind = new Map<string, Ref>();
          const materials: ArtifactRef[] = [];
          const approved = new Map<string, number>();
          const openQuestions = new Map<string, number>();
          // Options a person has yet to choose from mean the design is already under way.
          let designOptions = false;
          for (const item of list.artifacts) {
            const { kind, artifactId, version, sha256, approvedVersion } = item;
            if (kind === "design_option") {
              designOptions = true;
              continue;
            }
            if (kind === MATERIAL_KIND)
              materials.push({ kind, artifactId, version, sha256 });
            byKind.set(kind, { artifactId, version, sha256 });
            if (approvedVersion !== undefined)
              approved.set(kind, approvedVersion);
            if (item.openQuestionCount)
              openQuestions.set(kind, item.openQuestionCount);
          }
          return {
            byKind,
            materials,
            approved,
            openQuestions,
            designOptions,
            inFlight: list.inFlight,
            appBuilt: list.appBuilt,
            preferences: list.preferences,
          };
        };
        const readSource = async (ref: Ref) => {
          const { kind, title, content } = ArtifactContent.assert(
            await hub(
              projectPath +
                "/artifacts/" +
                encodeURIComponent(ref.artifactId) +
                "?version=" +
                String(ref.version),
            ),
          );
          if (kind !== "design") return { kind, title, content };
          // A writer reads the design's DESIGN.md; the screens stay in the bundle the coder gets.
          const { files } = DesignBundle.assert(JSON.parse(content));
          const screens = Object.keys(files).filter((path) =>
            path.startsWith("designs/"),
          );
          return {
            kind,
            title,
            content: files["DESIGN.md"] + "\n\nScreens: " + screens.join(", "),
          };
        };
        // This handler runs only after the native approval resolved, so the
        // versions it is about to hand off are the ones the person approved.
        const recordApproval = (
          tool: "request_approval" | "instruct_coder",
          artifacts: ArtifactRef[],
        ) => hub(projectPath + "/artifact-approvals", { tool, artifacts });
        const refsOf = (byKind: Map<string, Ref>) =>
          [...byKind].map(([kind, ref]) => ({ kind, ...ref }));
        const notFiled = (kind: string) =>
          new Refusal(
            kind +
              "_not_filed: " +
              (kind === "design"
                ? "have the designer make it with design_app first"
                : "write and file the " + kind + " first"),
          );
        const coderRunning = (runId: string) =>
          new Refusal(
            "coder_running: the coder is still working in run " +
              runId +
              "; its reply arrives as a message, and the next change can start after",
          );
        const required = (byKind: Map<string, Ref>, kind: string) => {
          const ref = byKind.get(kind);
          if (!ref) throw notFiled(kind);
          return ref;
        };
        type Listed = Awaited<ReturnType<typeof listed>>;
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
        // A fresh deployment warms its workspace with the current versions, the ones named here.
        const inputs = (
          kinds: readonly InputKind[],
          byKind: Map<string, Ref>,
        ) =>
          kinds.map((kind) => ({
            kind,
            version: required(byKind, kind).version,
          }));
        // Mail to a fresh deployment lands in its durable inbox and fires the run, so the deploy
        // response is enough to send the assignment, which carries the person's preferences that
        // apply to the receiving role.
        const deploy = async (
          role: "writer" | "reviewer" | "coder" | "designer" | "presenter",
          workflowSpec: NativeSpecialistDeployment | undefined,
          preferences: Preferences,
          correlationId: string,
          content: string,
          beforeAssign?: (runId: string) => Promise<unknown>,
        ) => {
          if (!workflowSpec)
            throw new Refusal(
              role + "_unavailable: no " + role + " workflow is installed",
            );
          const deployment = WorkflowDeploymentResponse.assert(
            await hub(
              "/api/tenants/" +
                encodeURIComponent(options.tenantId) +
                "/workflows/deployments",
              workflowSpec,
              DEPLOY_TIMEOUT_MS,
            ),
          );
          await beforeAssign?.(deployment.id);
          await env.capabilities.resolve("mail.transport").send(
            {
              to: [
                deriveRunAddress({
                  runId: deployment.id,
                  domain: options.domain,
                }),
              ],
              type: "conversation.message",
              correlationId: correlationId + "-" + deployment.id,
              content: content + preferenceBlock(preferences, role),
            },
            signal,
          );
          return { runId: deployment.id, role, status: deployment.status };
        };
        const coderPreamble = (byKind: Map<string, Ref>, note = "") =>
          startHere(
            inputs(CODER_INPUTS, byKind),
            required(byKind, "design").version,
          ) + note;
        // A run that replied is between turns while teardown versions its last files and gives up its
        // access, VERSION_CLOSE_MS in the sidecar's tools, before it ends. A start for the same
        // work waits that out, with room for the run to settle, rather than refuse a change the person
        // just approved. Any other live run is still at work.
        const ended = async (
          isRun: (run: Listed["inFlight"][number]) => boolean,
        ) => {
          const deadline = Date.now() + TEARDOWN_WAIT_MS;
          for (;;) {
            const state = await listed();
            const live = state.inFlight.find(isRun);
            if (
              !live ||
              live.status !== "running" ||
              live.state !== "waiting" ||
              Date.now() >= deadline
            )
              return { state, live };
            await sleep(TEARDOWN_POLL_MS, undefined, { signal });
          }
        };
        try {
          signal.throwIfAborted();
          let result: unknown;
          let canStart: readonly string[] = [];
          if (call.name === "request_approval") {
            const { kinds } = validArguments(RequestApproval, call.arguments);
            const state = await listed();
            const { byKind, materials, openQuestions, preferences } = state;
            const open = [...new Set(kinds)].flatMap((kind) => {
              const count = openQuestions.get(kind);
              return count
                ? [`${kind} has ${count} open question${count > 1 ? "s" : ""}`]
                : [];
            });
            if (open.length && asksOpenQuestions(preferences))
              throw new Refusal(
                "open_questions: " +
                  open.join(", ") +
                  "; read_artifact shows each one's openQuestions to put to the person with ask_questions, and the document revised with their answers can then be approved",
              );
            const documents = [...new Set(kinds)].flatMap((kind) => {
              if (kind !== MATERIAL_KIND)
                return [{ kind, ...required(byKind, kind) }];
              if (!materials.length)
                throw new Refusal(
                  "material_not_filed: the project has no material to approve",
                );
              return materials;
            });
            await recordApproval("request_approval", documents);
            for (const { kind, version } of documents)
              state.approved.set(kind, version);
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
            result = await startOnce(
              options.projectId + ":coder",
              "coder",
              async () => {
                const { state, live } = await ended(
                  (run) => run.role === "coder",
                );
                if (live) throw coderRunning(live.runId);
                const { byKind, preferences } = state;
                const refusal = coderGate(state);
                if (refusal) throw refusal;
                if (state.appBuilt)
                  throw new Refusal(
                    "app_already_built: the app's first build is done; send changes with instruct_coder",
                  );
                return deploy(
                  "coder",
                  options.workflows.coder,
                  preferences,
                  "coder",
                  coderPreamble(byKind) + coderTaskMessage(input.instruction),
                );
              },
            );
          } else if (call.name === "instruct_coder") {
            const input = validArguments(InstructCoder, call.arguments);
            result = await startOnce(
              options.projectId + ":coder",
              "coder",
              async () => {
                // One coder works on the app at a time; the change starts once the last one ended.
                const { state, live } = await ended(
                  (run) => run.role === "coder",
                );
                if (live) throw coderRunning(live.runId);
                const { byKind, preferences } = state;
                for (const kind of CODER_DOCUMENTS) required(byKind, kind);
                // The first build's documents need their own approvals, which deploy_coder checks; an
                // approved change is no approval of them.
                if (!state.appBuilt)
                  throw new Refusal(
                    "app_not_built: the app's first build is not done, so start or continue it with deploy_coder, which needs no approval",
                  );
                await recordApproval("instruct_coder", refsOf(byKind));
                return deploy(
                  "coder",
                  options.workflows.coder,
                  preferences,
                  "coder-" + call.id,
                  coderPreamble(byKind, APP_CHANGE_NOTE) +
                    coderTaskMessage(input.instruction),
                );
              },
            );
          } else if (call.name === "design_app") {
            const input = validArguments(DesignApp, call.arguments);
            const { inFlight } = await listed();
            // The person decides how many concepts start; the preference guides the coordinator when
            // they named no number, so only the ceiling holds here.
            const limit = designConceptCeiling();
            // A requested concept already at work is refused below but still counts toward the limit.
            const concepts = new Set(
              inFlight.flatMap((run) =>
                run.role === "designer" && run.concept ? [run.concept] : [],
              ),
            );
            for (const concept of input.concepts) concepts.add(concept.label);
            if (concepts.size > limit)
              throw new Refusal(
                "too_many_concepts: at most " +
                  String(limit) +
                  " design concepts can be at work at a time, counting those already started",
              );
            // Each pass on a concept is its own designer, one at a time.
            const design = (concept: DesignConcept) =>
              startOnce(
                options.projectId + ":designer:" + concept.label,
                "designer",
                async () => {
                  // A designer still "deployed" never received its assignment, so it does not hold
                  // the concept.
                  const { state, live } = await ended(
                    (run) =>
                      run.role === "designer" &&
                      run.status === "running" &&
                      run.concept === concept.label,
                  );
                  const { byKind, preferences } = state;
                  const refusal = designGate(state);
                  if (refusal) throw refusal;
                  if (live)
                    throw new Refusal(
                      "designer_running: the " +
                        concept.label +
                        " designer is still working in run " +
                        live.runId +
                        "; its design arrives as a message, and the next pass on it can start after",
                    );
                  const started = await deploy(
                    "designer",
                    options.workflows.designer,
                    preferences,
                    "designer",
                    startHere(inputs(DESIGNER_INPUTS, byKind)) +
                      designConceptAssignment(concept) +
                      designLookIdeas(input.lookIdeas) +
                      coderTaskMessage(input.instruction),
                    (runId) =>
                      hub(projectPath + "/design-concepts", {
                        runId,
                        concept,
                      }),
                  );
                  return { ...started, concept: concept.label };
                },
              );
            // One concept that fails to start leaves the others at work, so each reports its own outcome.
            result = (await Promise.allSettled(input.concepts.map(design))).map(
              (outcome, index) =>
                outcome.status === "fulfilled"
                  ? outcome.value
                  : {
                      concept: input.concepts[index]!.label,
                      error: refusalText(outcome.reason),
                    },
            );
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
