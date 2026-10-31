import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { defineWorkflow, step, type Selector } from "@intx/workflow/definition";

export function createCoordinatorWorkflow<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly address: string;
  readonly agent: AgentDefinition<Env>;
  readonly inference?: Selector;
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
    mailAccept: { invoker: true, correspondent: true },
    triggers: [{ type: "mail", to: options.address }],
    steps: {
      coordinate: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        drainBehavior: "wait",
        triggers: "unbounded",
        ...(options.inference !== undefined
          ? { inference: options.inference }
          : {}),
      }),
    },
  });
}
