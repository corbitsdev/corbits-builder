// A specialist's way out when something outside its control stops the work: it reports the block,
// its next reply ends the run, and the coordinator is told why. Every specialist package lists these
// tools; the director offers report_blocked to the model and keeps end_blocked_run as its own call.
import { type } from "arktype";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { RunBlock } from "@corbits-builder/schemas/activity";
import { describedSchema } from "@corbits-builder/plugin-host/coordinator";
import { workflowHttpJson } from "./http-json.ts";
import {
  projectScopeFailure,
  resolveWorkflowProjectScope,
} from "./project-scope.ts";

export const REPORT_BLOCKED = "report_blocked";
export const END_BLOCKED_RUN = "end_blocked_run";

/** The rule every specialist's system prompt carries, beside the tool that follows it. */
export const BLOCKED_RULE = `If the same thing fails twice for a reason you cannot change, stop and report it with ${REPORT_BLOCKED} instead of trying again. A refusal that says trying again will not help is such a reason.`;

const reportDefinition = {
  name: REPORT_BLOCKED,
  description: [
    "Report that something outside your control stops your task, so Builder records the block on your run.",
    "Use it when the same thing failed twice for a reason you cannot change, such as a refusal that says trying again will not help, or when something your task needs does not exist.",
    "Do not use it for work that is only unfinished or hard: keep working. Do not use it to ask the person something: that question goes in your hand-back.",
    "After it, reply once, in a sentence or two. That reply ends your run, and Builder tells the coordinator you were blocked, why, and what you tried.",
  ].join(" "),
  inputSchema: describedSchema(RunBlock, {
    reason: {
      about:
        "One or two plain sentences on what stops the work, such as the refusal you got and what it refused.",
    },
    tried: {
      about: "What you already tried, in a sentence or two.",
    },
  }),
};

// The director's own call, never offered to the model: it ends the run once the block is recorded,
// recording Builder's own block first when given one.
const endDefinition = {
  name: END_BLOCKED_RUN,
  description: "Ends this run as blocked. Called by Builder, not by the agent.",
  inputSchema: { ...RunBlock.partial().toJsonSchema() },
};

const Ending = RunBlock.or({ "+": "reject" });

interface BlockedToolEnv extends BaseEnv {
  capabilities: RuntimeCapabilities;
}

/** The blocked exit of a specialist playing the named role. */
export function createBlockedTools(role: string) {
  const definitions = [reportDefinition, endDefinition];
  return defineTool<BlockedToolEnv>({
    id: "@corbits-builder/blocked/tools",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: definitions.map(({ name }) => ({ name })),
    factory: (env) => ({
      definitions,
      run: async (call, signal) => {
        const input =
          call.name === REPORT_BLOCKED
            ? RunBlock(call.arguments)
            : Ending(call.arguments);
        if (input instanceof type.errors)
          return {
            callId: call.id,
            content: `invalid_arguments: ${input.summary}`,
            isError: true,
          };
        try {
          const scope = await resolveWorkflowProjectScope(
            env.capabilities,
            role,
            signal,
          );
          const path = `/api/tenants/${encodeURIComponent(scope.tenantId)}/projects/${encodeURIComponent(scope.projectId)}/run-block`;
          const request = (to: string, body: unknown) =>
            workflowHttpJson({
              capabilities: env.capabilities,
              handle: HUB_CREDENTIAL_HANDLE,
              path: to,
              body,
              maxResponseBytes: 16384,
              signal,
            });
          if ("reason" in input) await request(path, input);
          if (call.name === REPORT_BLOCKED)
            return {
              callId: call.id,
              content:
                "Recorded. Now reply once, in a sentence or two, saying what blocks the work; that reply ends your run and Builder tells the coordinator.",
            };
          await request(`${path}/end`, {});
          return { callId: call.id, content: "ended" };
        } catch (error) {
          return projectScopeFailure(call.id, error);
        }
      },
    }),
  });
}
