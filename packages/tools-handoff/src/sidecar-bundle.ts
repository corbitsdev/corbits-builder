import { resolveWorkflowProjectScope } from "@corbits-builder/tools-hub";
import {
  defineTool,
  type AnnotatedToolFactory,
  type BaseEnv,
} from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { NativeSpecialistDeployment } from "@corbits-builder/schemas/native-specialist";
import type { HandoffConfig, HandoffScope } from "./config.ts";
import { handoffDefinitions } from "./definitions.ts";
import {
  askQuestions,
  deployCoder,
  deployWriter,
  designApp,
  instructCoder,
  requestApproval,
  reviewArtifact,
  type HandoffDeps,
} from "./handoff.ts";
import { projectHub } from "./project-hub.ts";
import { refusalText } from "./refusal.ts";

export const DEPLOY_TOOLS = "@corbits-builder/deploy/tools";

interface DeployEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

const handoffs: Record<string, (args: unknown, deps: HandoffDeps) => unknown> =
  {
    request_approval: requestApproval,
    deploy_writer: deployWriter,
    review_artifact: reviewArtifact,
    deploy_coder: deployCoder,
    instruct_coder: instructCoder,
    design_app: designApp,
  };

// Without a scope, each call resolves the run's project from the hub first.
export function createDeployTools(
  config: HandoffConfig,
  scope?: HandoffScope,
): AnnotatedToolFactory<DeployEnv> {
  if (scope)
    for (const deployment of Object.values(scope.workflows)) {
      const checked = NativeSpecialistDeployment.assert(deployment);
      if (!checked.sourceOfferingIds.includes(checked.defaultSourceOfferingId))
        throw new Error("invalid_specialist_default_offering");
    }
  const definitions = handoffDefinitions(config);
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
    ],
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        if (call.name === "ask_questions") {
          try {
            return {
              callId: call.id,
              content: askQuestions(call.arguments, config),
            };
          } catch (error) {
            return {
              callId: call.id,
              content: refusalText(error),
              isError: true,
            };
          }
        }
        if (!scope) {
          try {
            const resolved = await resolveWorkflowProjectScope(
              env.capabilities,
              "coordinator",
              signal,
            );
            return createDeployTools(config, {
              tenantId: resolved.tenantId,
              projectId: resolved.projectId,
              domain: resolved.domain,
              workflows: resolved.workflows,
              maxResultBytes: 300 * 1024,
            })(env).run(call, signal);
          } catch (error) {
            return config.failure(call.id, error);
          }
        }
        const handoff = handoffs[call.name];
        try {
          signal.throwIfAborted();
          if (!handoff)
            return {
              callId: call.id,
              content: "unknown_deploy_tool",
              isError: true,
            };
          const result = await handoff(call.arguments, {
            config,
            scope,
            project: projectHub({
              config,
              scope,
              capabilities: env.capabilities,
              signal,
            }),
            callId: call.id,
          });
          return { callId: call.id, content: JSON.stringify(result) };
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
