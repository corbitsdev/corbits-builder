import { type } from "arktype";
import { Effort, type RoleBinding } from "@corbits-builder/schemas/models";
import {
  bindingLimits,
  modelProvider,
  type ModelDirectory,
} from "../config/models.ts";
import { isBudget } from "../inference/model-limits.ts";

export const RoleInference = type({
  "+": "reject",
  source: { "+": "reject", provider: "string > 0", model: "string > 0" },
  contextWindow: "number.integer > 0",
  // Not per-call parameters: Interchange's step selector rejects them, so the director sets them.
  timeouts: { "+": "reject", "totalTimeoutMs?": "number.integer > 0" },
  parameters: {
    "+": "reject",
    "effort?": Effort,
    maxTokens: "number.integer > 0",
    "temperature?": "number >= 0",
  },
});
export type RoleInference = typeof RoleInference.infer;

/**
 * The model source, its window and the per-call parameters one role's package runs with, by the
 * output budget the role names. Resolved on the hub, where a workspace's custom models are known.
 */
export function resolveRoleInference(
  directory: ModelDirectory,
  limitsName: string,
  bound: RoleBinding,
): RoleInference {
  const provider = modelProvider(directory, bound.provider);
  const plugin = provider?.plugin;
  if (!plugin) throw new Error(`model_provider_unknown:${bound.provider}`);
  const limits = bindingLimits(directory, bound.provider, bound.model);
  if (!limits)
    throw new Error(`model_limits_required:${bound.provider}:${bound.model}`);
  if (!isBudget(limitsName))
    throw new Error(`model_budget_unknown:${limitsName}`);
  const budget = limits.roles[limitsName];
  return {
    source: { provider: plugin, model: bound.model },
    contextWindow: limits.contextWindow,
    timeouts:
      provider.totalTimeoutMs !== undefined
        ? { totalTimeoutMs: provider.totalTimeoutMs }
        : {},
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
export function roleInference(role: string): RoleInference {
  const inlined = process.env.BUILDER_ROLE_INFERENCE;
  if (!inlined) throw new Error(`role_inference_required:${role}`);
  return RoleInference.assert(JSON.parse(inlined));
}
