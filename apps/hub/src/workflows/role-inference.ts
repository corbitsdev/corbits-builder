import { type } from "arktype";
import { Effort, type RoleBinding } from "@corbits-builder/schemas/models";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { sharedRoles, type AgentRole } from "../inference/model-limits.ts";
import {
  bindingLimits,
  modelProvider,
  type ModelDirectory,
  type Timeouts,
} from "../config/models.ts";

// A provider that sets no limits of its own runs on Interchange's.
const INTERCHANGE_DEFAULTS: Timeouts = {};

export const RoleInference = type({
  "+": "reject",
  source: { "+": "reject", provider: "string > 0", model: "string > 0" },
  contextWindow: "number.integer > 0",
  // Not per-call parameters: Interchange's step selector rejects them, so the director sets them.
  timeouts: {
    "+": "reject",
    "totalTimeoutMs?": "number.integer > 0",
    "inactivityTimeoutMs?": "number.integer > 0",
  },
  parameters: {
    "+": "reject",
    "effort?": Effort,
    maxTokens: "number.integer > 0",
    "temperature?": "number >= 0",
  },
});
export type RoleInference = typeof RoleInference.infer;

/**
 * The model source, its window and the per-call parameters one role's package runs with. Resolved
 * on the hub, where a workspace's custom models are known.
 */
export function resolveRoleInference(
  directory: ModelDirectory,
  output: string,
  bound: RoleBinding,
): RoleInference {
  const provider = modelProvider(directory, bound.provider);
  const plugin = provider?.plugin;
  if (!plugin) throw new Error(`model_provider_unknown:${bound.provider}`);
  const limits = bindingLimits(directory, bound.provider, bound.model);
  if (!limits)
    throw new Error(`model_limits_required:${bound.provider}:${bound.model}`);
  const isBudget = (name: string): name is AgentRole =>
    Object.hasOwn(sharedRoles, name);
  if (!isBudget(output)) throw new Error(`No budget ${output}`);
  const budget = limits.roles[output];
  return {
    source: { provider: plugin, model: bound.model },
    contextWindow: limits.contextWindow,
    timeouts: provider.timeouts ?? INTERCHANGE_DEFAULTS,
    parameters: {
      ...(limits.efforts.includes(bound.effort)
        ? { effort: bound.effort }
        : {}),
      maxTokens: budget.maxOutputTokens,
      ...(budget.temperature !== undefined
        ? { temperature: budget.temperature }
        : {}),
    },
  };
}

// build-packages.ts inlines what the project's profile resolved for this role, so the frozen
// definition carries it; an entry imported directly reads the one its importer set.
export function roleInference(role: WorkflowRole): RoleInference {
  const inlined = process.env.BUILDER_ROLE_INFERENCE;
  if (!inlined) throw new Error(`role_inference_required:${role}`);
  return RoleInference.assert(JSON.parse(inlined));
}
