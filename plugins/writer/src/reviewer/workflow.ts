import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { defineWorkflow, step, type Selector } from "@intx/workflow/definition";

// Matches the writer's bound until reviewer runs are measured.
// A host that raises the output cap raises this with it.
const STEP_TIMEOUT_MS = 600_000;

// One bounded review. The document and instructions arrive in the first message.
export function createReviewerWorkflow<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly address: string;
  readonly agent: AgentDefinition<Env>;
  readonly inference: Selector;
  readonly stepTimeoutMs?: number;
  readonly credentialBindings?: Parameters<
    typeof defineWorkflow
  >[0]["credentialBindings"];
  readonly grantRequirements?: Parameters<
    typeof defineWorkflow
  >[0]["grantRequirements"];
}) {
  return defineWorkflow({
    id: options.id,
    ...(options.credentialBindings
      ? { credentialBindings: options.credentialBindings }
      : {}),
    ...(options.grantRequirements
      ? { grantRequirements: options.grantRequirements }
      : {}),
    mailAccept: { invoker: true },
    triggers: [{ type: "mail", to: options.address }],
    steps: {
      review: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        inference: options.inference,
        drainBehavior: "wait",
        // No retry: a second attempt would redo work the first may already have mailed.
        timeout: options.stepTimeoutMs ?? STEP_TIMEOUT_MS,
        triggers: 1,
      }),
    },
  });
}
