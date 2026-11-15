import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { defineWorkflow, step, type Selector } from "@intx/workflow/definition";

// One build or one change. The documents and the task arrive in the first message; a later change
// is a new deployment that starts from the app this one saves.
export function createCoderWorkflow<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly address: string;
  readonly agent: AgentDefinition<Env>;
  readonly inference: Selector;
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
      build: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        inference: options.inference,
        drainBehavior: "wait",
        triggers: 1,
      }),
    },
  });
}
