import { RoleBinding } from "@corbits-builder/schemas/models";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { limitsRole, modelProvider } from "../config/models.ts";
import {
  modelEfforts,
  requireContextWindow,
  requireModelRole,
} from "../inference/model-limits.ts";

// build-packages.ts inlines the binding the project's profile gave this role, so the frozen
// definition names it; an entry imported directly reads the one its importer set.
const INLINED = process.env.BUILDER_ROLE_INFERENCE;

/** The model source, its window and the per-call parameters one role's package runs with. */
export function roleInference(role: WorkflowRole) {
  if (!INLINED) throw new Error(`role_binding_required:${role}`);
  const bound = RoleBinding.assert(JSON.parse(INLINED));
  const plugin = modelProvider(bound.provider)?.plugin;
  if (!plugin) throw new Error(`model_provider_unknown:${bound.provider}`);
  const budget = requireModelRole(
    bound.provider,
    bound.model,
    limitsRole(role),
  );
  return {
    source: { provider: plugin, model: bound.model },
    contextWindow: requireContextWindow(bound.provider, bound.model),
    parameters: {
      ...(modelEfforts(bound.provider, bound.model).includes(bound.effort)
        ? { effort: bound.effort }
        : {}),
      maxTokens: budget.maxOutputTokens,
      ...(budget.temperature !== undefined
        ? { temperature: budget.temperature }
        : {}),
    },
  };
}
