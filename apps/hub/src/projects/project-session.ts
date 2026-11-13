import type { BaseEnv } from "@intx/agent/authoring";
import { WorkflowDeploymentResponse } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { deriveRunAddress } from "@intx/workflow-deploy";
import { setTimeout as sleep } from "node:timers/promises";
import { type } from "arktype";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import { SourceRef } from "@corbits-builder/schemas";
import type { WorkflowProjectScope } from "@corbits-builder/schemas/installed-workflows";
import type { Role } from "@corbits-builder/plugin";
import {
  ArtifactContent,
  DesignBundle,
  type DesignConcept,
} from "@corbits-builder/schemas/artifact";
import { Refusal } from "@corbits-builder/plugin-host/coordinator";
import { Preferences } from "@corbits-builder/schemas/preferences";
import type { InputKind } from "../config/inputs.ts";
import {
  designConceptCeiling,
  preferenceBlock,
} from "../config/preferences.ts";
import { resolveWorkflowProjectScope } from "../workflows/project-scope.ts";
import { CATALOG, WORKFLOW_PACKAGES } from "../plugins/catalog.ts";
import { workflowHttpJson, WorkflowHttpError } from "../workflows/http-json.ts";
import { DESIGN_STYLES } from "../artifacts/design-tweaks.ts";

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
  busy: () => Error,
  start: () => Promise<T>,
): Promise<T> {
  if (starting.has(key)) throw busy();
  starting.add(key);
  try {
    return await start();
  } finally {
    starting.delete(key);
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

// The plugin action a session starts runs for, the plan step they do when the coordinator could
// tell which, and the block of project values each run's assignment carries.
type Assigned = {
  plugin: string;
  action: string;
  values: string;
  step: string | undefined;
};

/**
 * The coordinator's view of its project through the hub, and the way it starts a specialist there.
 * With assigned, each run it starts is recorded as started for that plugin action before its
 * assignment, which carries the action's block of project values.
 */
export function projectSession(
  env: DeployEnv,
  options: ProjectOptions,
  signal: AbortSignal,
  assigned?: Assigned,
) {
  const projectPath =
    "/api/tenants/" +
    encodeURIComponent(options.tenantId) +
    "/projects/" +
    encodeURIComponent(options.projectId);
  const hub = (
    path: string,
    body?: unknown,
    timeoutMs?: number,
    method?: "PUT",
  ) =>
    workflowHttpJson({
      capabilities: env.capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path,
      ...(body === undefined ? {} : { body }),
      ...(method === undefined ? {} : { method }),
      maxResponseBytes: options.maxResultBytes,
      signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  const listed = async () => {
    const list = ArtifactList.assert(await hub(projectPath + "/artifacts"));
    const byKind = new Map<string, Ref>();
    for (const { kind, artifactId, version, sha256 } of list.artifacts)
      if (kind !== "design_option")
        byKind.set(kind, { artifactId, version, sha256 });
    return {
      artifacts: list.artifacts,
      byKind,
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
  const readDesign = async (ref: Ref) => {
    const { title, content } = ArtifactContent.assert(
      await hub(
        projectPath +
          "/artifacts/" +
          encodeURIComponent(ref.artifactId) +
          "?version=" +
          String(ref.version),
      ),
    );
    const { files } = DesignBundle.assert(JSON.parse(content));
    const styles = files[DESIGN_STYLES];
    return styles === undefined
      ? { title, tokens: files["DESIGN.md"]! }
      : { title, tokens: files["DESIGN.md"]!, styles };
  };
  // A fresh deployment warms its workspace with the current versions, the ones named here.
  const inputs = (kinds: readonly InputKind[], byKind: Map<string, Ref>) =>
    kinds.map((kind) => {
      const ref = byKind.get(kind);
      if (!ref) throw new Error(`${kind} is not filed`);
      return { kind, version: ref.version };
    });
  // Mail to a fresh deployment lands in its durable inbox and fires the run, so the deploy
  // response is enough to send the assignment, which carries the person's preferences that
  // apply to the receiving role.
  const deploy = async (
    role: Role,
    workflowSpec: NativeSpecialistDeployment | undefined,
    preferences: Preferences,
    correlationId: string,
    content: string,
    beforeAssign?: (runId: string) => Promise<unknown>,
  ) => {
    if (!workflowSpec)
      throw new Refusal(
        role.name + "_unavailable: no " + role.name + " workflow is installed",
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
    if (assigned)
      await hub(projectPath + "/run-actions", {
        runId: deployment.id,
        plugin: assigned.plugin,
        action: assigned.action,
        step: assigned.step,
      });
    await beforeAssign?.(deployment.id);
    await env.capabilities.resolve("mail.transport").send(
      {
        to: [
          deriveRunAddress({ runId: deployment.id, domain: options.domain }),
        ],
        type: "conversation.message",
        correlationId: correlationId + "-" + deployment.id,
        content:
          content +
          (assigned?.values ?? "") +
          preferenceBlock(preferences, role),
      },
      signal,
    );
    return { runId: deployment.id, role: role.name, status: deployment.status };
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
  // The role and installed deployment of a workflow a project starts.
  const installed = (workflow: string) => {
    const name = WORKFLOW_PACKAGES.get(workflow);
    const role = name === undefined ? undefined : CATALOG.role(name);
    if (role === undefined)
      throw new Error(`${workflow} is not a workflow a project starts`);
    return { role, spec: options.workflows[workflow] };
  };
  // The one-at-a-time slot a role takes: its own, unless it declares it shares another's.
  const slotOf = (name: string) => CATALOG.role(name)?.slot ?? name;
  // One run in the workflow's role's slot at a time; a start waits for the last one to end. task builds
  // the assignment from the project as it then stands, and what to store against the run before
  // it is assigned, or refuses; busy says why none started, with the live run when one is still
  // working and none while another is starting.
  const startAlone = (
    workflow: string,
    correlationId: string,
    task: (state: Listed) => Promise<{
      content: string;
      beforeAssign?: (runId: string) => Promise<unknown>;
    }>,
    busy: (live?: Listed["inFlight"][number]) => Error,
  ) => {
    const { role, spec } = installed(workflow);
    const slot = slotOf(role.name);
    return startOnce(options.projectId + ":" + slot, busy, async () => {
      const { state, live } = await ended((run) => slotOf(run.role) === slot);
      if (live) throw busy(live);
      const { content, beforeAssign } = await task(state);
      return deploy(
        role,
        spec,
        state.preferences,
        correlationId,
        content,
        beforeAssign,
      );
    });
  };
  // A run of the workflow for each concept, each concept one run's at a time and recorded as that
  // run's before its assignment. task builds a concept's assignment from the project as it then
  // stands, or refuses; busy says why a concept did not start, with the live run when one still
  // works on it and none while another is starting. Each concept reports its own outcome.
  const startConcepts = async (
    workflow: string,
    correlationId: string,
    concepts: readonly DesignConcept[],
    task: (state: Listed, concept: DesignConcept) => string,
    busy: (concept: string, live?: Listed["inFlight"][number]) => Error,
  ) => {
    const { role, spec } = installed(workflow);
    const { inFlight } = await listed();
    // The person decides how many concepts start; the preference guides the coordinator when they
    // named no number, so only the ceiling holds here.
    const limit = designConceptCeiling();
    // A requested concept already at work is refused below but still counts toward the limit.
    const labels = new Set(
      inFlight.flatMap((run) =>
        run.role === role.name && run.concept ? [run.concept] : [],
      ),
    );
    for (const concept of concepts) labels.add(concept.label);
    if (labels.size > limit)
      throw new Refusal(
        "too_many_concepts: at most " +
          String(limit) +
          " design concepts can be at work at a time, counting those already started",
      );
    const start = (concept: DesignConcept) =>
      startOnce(
        options.projectId + ":" + role.name + ":" + concept.label,
        () => busy(concept.label),
        async () => {
          // A run still "deployed" never received its assignment, so it does not hold the concept.
          const { state, live } = await ended(
            (run) =>
              run.role === role.name &&
              run.status === "running" &&
              run.concept === concept.label,
          );
          const content = task(state, concept);
          if (live) throw busy(concept.label, live);
          const started = await deploy(
            role,
            spec,
            state.preferences,
            correlationId,
            content,
            (runId) =>
              hub(projectPath + "/run-records", {
                runId,
                name: "concept",
                data: concept,
              }),
          );
          return { ...started, concept: concept.label };
        },
      );
    // One concept that fails to start leaves the others at work, so each reports its own outcome.
    return (await Promise.allSettled(concepts.map(start))).map(
      (outcome, index) =>
        outcome.status === "fulfilled"
          ? outcome.value
          : {
              concept: concepts[index]!.label,
              error: refusalText(outcome.reason),
            },
    );
  };
  return {
    options,
    projectPath,
    hub,
    listed,
    readSource,
    readDesign,
    inputs,
    deploy,
    installed,
    startAlone,
    startConcepts,
    // The same session, starting runs for a plugin action.
    forAction: (action: Assigned) =>
      projectSession(env, options, signal, action),
  };
}

export type ProjectSession = ReturnType<typeof projectSession>;
export type ProjectListing = Awaited<ReturnType<ProjectSession["listed"]>>;
