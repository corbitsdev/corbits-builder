import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { defineWorkflow, step, type Selector } from "@intx/workflow/definition";

// One design pass. The concept, its documents and the task arrive in the first message; a later
// pass on the concept is a new deployment that starts from the draft this one leaves.
export function createDesignerWorkflow<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly address: string;
  readonly agent: AgentDefinition<Env>;
  readonly inference: Selector;
  readonly grantRequirements?: Parameters<
    typeof defineWorkflow
  >[0]["grantRequirements"];
}) {
  return defineWorkflow({
    id: options.id,
    ...(options.grantRequirements
      ? { grantRequirements: options.grantRequirements }
      : {}),
    mailAccept: { invoker: true },
    triggers: [{ type: "mail", to: options.address }],
    sidecarPlacement: {
      capabilities: [{ capability: "runtime:posix", effect: "require" }],
    },
    steps: {
      design: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        inference: options.inference,
        drainBehavior: "wait",
        triggers: 1,
      }),
    },
  });
}
