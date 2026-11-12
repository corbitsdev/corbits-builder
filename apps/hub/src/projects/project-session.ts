import type { BaseEnv } from "@intx/agent/authoring";
import { WorkflowDeploymentResponse } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { deriveRunAddress } from "@intx/workflow-deploy";
import { setTimeout as sleep } from "node:timers/promises";
import { type, TraversalError } from "arktype";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { SourceRef } from "@corbits-builder/schemas";
import type { WorkflowProjectScope } from "@corbits-builder/schemas/installed-workflows";
import {
  ArtifactContent,
  DesignBundle,
  DocumentKind,
  MATERIAL_KIND,
  type ArtifactRef,
  type DesignConcept,
} from "@corbits-builder/schemas/artifact";
import { coderTaskMessage } from "@corbits-builder/coder/contract";
import { Preferences } from "@corbits-builder/schemas/preferences";
import type { InputKind } from "../config/inputs.ts";
import {
  asksOpenQuestions,
  designConceptCeiling,
  preferenceBlock,
} from "../config/preferences.ts";
import { designConceptAssignment, designLookIdeas } from "../config/design.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { workflowHttpJson, WorkflowHttpError } from "../workflows/http-json.ts";

export interface DeployEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

export type ProjectOptions = {
  tenantId: string;
  projectId: string;
  domain: string;
  workflows: WorkflowProjectScope["workflows"];
  maxResultBytes: number;
};

// Any filed document's kind, or material.
export const RequestApproval = type({
  "+": "reject",
  kinds: DocumentKind.or(`'${MATERIAL_KIND}'`).array().atLeastLength(1),
});
export const REQUEST_APPROVAL_DESCRIPTION =
  "Ask the person to approve the filed documents of the given kinds, each at its current version; for material, every attached or imported material. One ask covers every document ready for the person, so list them all together, an earlier document with the ones that follow it. Ask for approval once the documents have no open questions left; open questions the person must decide go to them with the question tool first. Their approval is what lets the writer of the next document start from them, and a changed document is approved again.";

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

export class Refusal extends Error {}

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
export async function startOnce<T>(
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

export function validArguments<T>(
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

export const refusalText = (error: unknown) =>
  error instanceof Refusal
    ? error.message
    : error instanceof WorkflowHttpError
      ? hubRefusal(error)
      : error instanceof Error
        ? error.name + ": " + error.message
        : String(error);

/** The project the coordinator's run belongs to, with the specialists it may start. */
export async function resolveProjectOptions(
  capabilities: RuntimeCapabilities,
  signal: AbortSignal,
): Promise<ProjectOptions> {
  const scope = await resolveWorkflowProjectScope(
    capabilities,
    "coordinator",
    signal,
  );
  return {
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    domain: scope.domain,
    workflows: scope.workflows,
    maxResultBytes: 300 * 1024,
  };
}

export function checkDeployments(workflows: ProjectOptions["workflows"]) {
  for (const deployment of Object.values(workflows)) {
    if (!deployment) continue;
    const checked = NativeSpecialistDeployment.assert(deployment);
    if (!checked.sourceOfferingIds.includes(checked.defaultSourceOfferingId))
      throw new Error("invalid_specialist_default_offering");
  }
}

/**
 * The coordinator's view of its project through the hub, and the way it starts a specialist there.
 * values is the block of project values every assignment it sends carries.
 */
export function projectSession(
  env: DeployEnv,
  options: ProjectOptions,
  signal: AbortSignal,
  values = "",
) {
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
    const list = ArtifactList.assert(await hub(projectPath + "/artifacts"));
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
      if (approvedVersion !== undefined) approved.set(kind, approvedVersion);
      if (item.openQuestionCount)
        openQuestions.set(kind, item.openQuestionCount);
    }
    return {
      artifacts: list.artifacts,
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
  type Listed = Awaited<ReturnType<typeof listed>>;
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
  // This runs only after the native approval resolved, so the versions it is about to hand off are
  // the ones the person approved.
  const recordApproval = (
    tool: "request_approval" | "instruct_coder",
    artifacts: ArtifactRef[],
  ) => hub(projectPath + "/artifact-approvals", { tool, artifacts });
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
  // A fresh deployment warms its workspace with the current versions, the ones named here.
  const inputs = (kinds: readonly InputKind[], byKind: Map<string, Ref>) =>
    kinds.map((kind) => ({ kind, version: required(byKind, kind).version }));
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
          deriveRunAddress({ runId: deployment.id, domain: options.domain }),
        ],
        type: "conversation.message",
        correlationId: correlationId + "-" + deployment.id,
        content: content + values + preferenceBlock(preferences, role),
      },
      signal,
    );
    return { runId: deployment.id, role, status: deployment.status };
  };
  // A run that replied is between turns while teardown versions its last files and gives up its
  // access, VERSION_CLOSE_MS in the sidecar's tools, before it ends. A start for the same
  // work waits that out, with room for the run to settle, rather than refuse a change the person
  // just approved. Any other live run is still at work.
  const ended = async (isRun: (run: Listed["inFlight"][number]) => boolean) => {
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
  // One coder works on the app at a time; a start waits for the last one to end. task builds the
  // assignment from the project as it then stands, or refuses.
  const startCoder = (
    correlationId: string,
    task: (state: Listed) => string | Promise<string>,
  ) =>
    startOnce(options.projectId + ":coder", "coder", async () => {
      const { state, live } = await ended((run) => run.role === "coder");
      if (live) throw coderRunning(live.runId);
      return deploy(
        "coder",
        options.workflows.coder,
        state.preferences,
        correlationId,
        await task(state),
      );
    });
  // A designer for each concept, each from documents that opens its assignment, or refuses.
  const startDesigners = async (
    input: {
      instruction: string;
      lookIdeas: string;
      concepts: DesignConcept[];
    },
    documents: (state: Listed) => string,
  ) => {
    const { inFlight } = await listed();
    // The person decides how many concepts start; the preference guides the coordinator when they
    // named no number, so only the ceiling holds here.
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
          const opening = documents(state);
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
            state.preferences,
            "designer",
            opening +
              designConceptAssignment(concept) +
              designLookIdeas(input.lookIdeas) +
              coderTaskMessage(input.instruction),
            (runId) =>
              hub(projectPath + "/design-concepts", { runId, concept }),
          );
          return { ...started, concept: concept.label };
        },
      );
    // One concept that fails to start leaves the others at work, so each reports its own outcome.
    return (await Promise.allSettled(input.concepts.map(design))).map(
      (outcome, index) =>
        outcome.status === "fulfilled"
          ? outcome.value
          : {
              concept: input.concepts[index]!.label,
              error: refusalText(outcome.reason),
            },
    );
  };
  // Records the person's approval of the kinds their request_approval named, each at its current version.
  const approve = async (kinds: (typeof RequestApproval.infer)["kinds"]) => {
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
          "; read_artifact shows each one's openQuestions to put to the person with the question tool, and the document revised with their answers can then be approved",
      );
    const documents = [...new Set(kinds)].flatMap((kind) => {
      if (kind !== MATERIAL_KIND) return [{ kind, ...required(byKind, kind) }];
      if (!materials.length)
        throw new Refusal(
          "material_not_filed: the project has no material to approve",
        );
      return materials;
    });
    await recordApproval("request_approval", documents);
    for (const { kind, version } of documents)
      state.approved.set(kind, version);
    return { state, documents };
  };
  return {
    options,
    projectPath,
    hub,
    listed,
    readSource,
    recordApproval,
    notFiled,
    coderRunning,
    required,
    inputs,
    deploy,
    ended,
    approve,
    startCoder,
    startDesigners,
    // The same session, its assignments carrying this block of project values.
    withValues: (block: string) => projectSession(env, options, signal, block),
  };
}

export type ProjectSession = ReturnType<typeof projectSession>;
export type ProjectListing = Awaited<ReturnType<ProjectSession["listed"]>>;
