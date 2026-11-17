import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { defineWorkflow, step, type Selector } from "@intx/workflow/definition";

const STEP_TIMEOUT_MS = 600_000;

// One bounded presentation run: builds the deck, checks it, and files the approval package.
export function createPresenterWorkflow<Env extends BaseEnv>(options: {
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
    sidecarPlacement: {
      capabilities: [{ capability: "runtime:posix", effect: "require" }],
    },
    steps: {
      present: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        inference: options.inference,
        drainBehavior: "wait",
        timeout: options.stepTimeoutMs ?? STEP_TIMEOUT_MS,
        triggers: 1,
      }),
    },
  });
}
