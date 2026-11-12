import type { AgentDefinition, BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import {
  action,
  defineWorkflow,
  loop,
  step,
  type Selector,
} from "@intx/workflow/definition";
import { RUN_CHECK } from "./done.ts";

// How many times the coder works on one assignment before the run ends not finished.
const PASSES = 3;

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

// The same work, done only when the action's done checks pass on the app as saved. Each pass is
// the agent's step and then a code step that asks the hub to run those checks; a failure sends the
// assignment back with the evidence, and after the last pass the run ends not finished with that
// evidence as its reason. Not installed yet: a loop's agent starts each pass in a fresh
// conversation and workspace, and the hub reads a coder run as one warm top-level agent step.
export function createCoderDoneWorkflow<Env extends BaseEnv>(options: {
  readonly id: string;
  readonly address: string;
  readonly agent: AgentDefinition<Env>;
  readonly inference: Selector;
  // The check actions of the coder that must pass, as the starting action's done names them.
  readonly done: readonly string[];
  readonly grantRequirements?: Parameters<
    typeof defineWorkflow
  >[0]["grantRequirements"];
}) {
  const pass = defineWorkflow({
    id: options.id + "-pass",
    steps: {
      build: step({
        agent: options.agent,
        input: { from: "trigger.payload" },
        inference: options.inference,
        drainBehavior: "wait",
      }),
      done: action({
        after: ["build"],
        handler: "runDoneChecks",
        input: { literal: { checks: options.done } },
        credentials: [HUB_CREDENTIAL_HANDLE],
        effect: { requires: [RUN_CHECK] },
      }),
    },
  });
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
      passes: loop({
        body: pass,
        while: "checksFailed",
        carry: "sendBack",
        input: { from: "trigger.payload" },
        maxIterations: PASSES,
        onExhausted: "notFinished",
      }),
      notFinished: action({
        after: ["passes"],
        handler: "notFinished",
        input: { from: "steps.passes.output.final" },
      }),
    },
  });
}
