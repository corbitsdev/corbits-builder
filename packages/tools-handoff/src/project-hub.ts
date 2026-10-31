import { workflowHttpJson } from "@corbits-builder/tools-hub";
import { WorkflowDeploymentResponse } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { deriveRunAddress } from "@intx/workflow-deploy";
import { type } from "arktype";
import {
  ArtifactContent,
  DesignBundle,
  MATERIAL_KIND,
  type ArtifactRef,
} from "@corbits-builder/schemas/artifact";
import { Preferences } from "@corbits-builder/schemas/preferences";
import type {
  HandoffConfig,
  HandoffScope,
  InputKind,
  Ref,
  SpecialistRole,
} from "./config.ts";
import { Refusal } from "./refusal.ts";

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
    "concept?": "string > 0",
  }).array(),
  preferences: Preferences,
});

// The deployments route answers only after it installs, probes and gates the source, each stage
// under its own native deadline: sidecar ensure and connection 120s each, the probe 60s. A shorter
// client deadline abandons a deploy the hub still completes.
const DEPLOY_TIMEOUT_MS = 300_000;

export const refsOf = (byKind: Map<string, Ref>) =>
  [...byKind].map(([kind, ref]) => ({ kind, ...ref }));

export const required = (byKind: Map<string, Ref>, kind: string) => {
  const ref = byKind.get(kind);
  if (!ref)
    throw new Refusal(
      kind +
        "_not_filed: " +
        (kind === "design"
          ? "have the designer make it with design_app first"
          : "write and file the " + kind + " first"),
    );
  return ref;
};

// A fresh deployment warms its workspace with the current versions, the ones named here.
export const inputs = (kinds: readonly InputKind[], byKind: Map<string, Ref>) =>
  kinds.map((kind) => ({
    kind,
    version: required(byKind, kind).version,
  }));

export type ProjectHub = ReturnType<typeof projectHub>;

// The hub routes of one project, reached through the run's mediated hub credential.
export function projectHub(options: {
  config: Pick<HandoffConfig, "preferenceBlock">;
  scope: HandoffScope;
  capabilities: RuntimeCapabilities;
  signal: AbortSignal;
}) {
  const { config, scope, capabilities, signal } = options;
  const projectPath =
    "/api/tenants/" +
    encodeURIComponent(scope.tenantId) +
    "/projects/" +
    encodeURIComponent(scope.projectId);
  const hub = (path: string, body?: unknown, timeoutMs?: number) =>
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path,
      ...(body === undefined ? {} : { body }),
      maxResponseBytes: scope.maxResultBytes,
      signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  const listed = async () => {
    const list = ArtifactList.assert(await hub(projectPath + "/artifacts"));
    const byKind = new Map<string, Ref>();
    const materials: ArtifactRef[] = [];
    const approved = new Map<string, number>();
    const openQuestions = new Map<string, number>();
    for (const item of list.artifacts) {
      const { kind, artifactId, version, sha256, approvedVersion } = item;
      if (kind === "design_option") continue;
      if (kind === MATERIAL_KIND)
        materials.push({ kind, artifactId, version, sha256 });
      byKind.set(kind, { artifactId, version, sha256 });
      if (approvedVersion !== undefined) approved.set(kind, approvedVersion);
      if (item.openQuestionCount)
        openQuestions.set(kind, item.openQuestionCount);
    }
    return {
      byKind,
      materials,
      approved,
      openQuestions,
      inFlight: list.inFlight,
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
  // A tool calls this only after the native approval resolved, so the
  // versions it is about to hand off are the ones the person approved.
  const recordApproval = (
    tool: "request_approval" | "instruct_coder",
    artifacts: ArtifactRef[],
  ) => hub(projectPath + "/artifact-approvals", { tool, artifacts });
  const recordDesignConcept = (body: unknown) =>
    hub(projectPath + "/design-concepts", body);
  // Every assignment carries the person's preferences that apply to the receiving role.
  const assign = (
    runId: string,
    role: SpecialistRole,
    preferences: Preferences,
    correlationId: string,
    content: string,
  ) =>
    capabilities.resolve("mail.transport").send(
      {
        to: [deriveRunAddress({ runId, domain: scope.domain })],
        type: "conversation.message",
        correlationId,
        content: content + config.preferenceBlock(preferences, role),
      },
      signal,
    );
  // Mail to a fresh deployment lands in its durable inbox and fires the
  // run, so the deploy response is enough to send the assignment.
  const deploy = async (
    role: SpecialistRole,
    preferences: Preferences,
    correlationId: string,
    content: string,
    beforeAssign?: (runId: string) => Promise<unknown>,
  ) => {
    const deployment = WorkflowDeploymentResponse.assert(
      await hub(
        "/api/tenants/" +
          encodeURIComponent(scope.tenantId) +
          "/workflows/deployments",
        scope.workflows[role],
        DEPLOY_TIMEOUT_MS,
      ),
    );
    await beforeAssign?.(deployment.id);
    await assign(
      deployment.id,
      role,
      preferences,
      correlationId + "-" + deployment.id,
      content,
    );
    return { runId: deployment.id, role, status: deployment.status };
  };
  return {
    listed,
    readSource,
    recordApproval,
    recordDesignConcept,
    assign,
    deploy,
  };
}
