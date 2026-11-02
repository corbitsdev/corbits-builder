// One record per provider entry (config/models.ts) and model. Adding a model is a record here.
// The window includes the reserved completion. Role budgets stay below the window so the prompt
// still fits. A missing record fails closed. How hard each role reasons is the profile's choice
// (config/models.ts), not the model's.

import type { CustomModel } from "@corbits-builder/schemas/models";

export type AgentRole = "coordinator" | "document" | "coding" | "design";

type Effort = "low" | "medium" | "high" | "max";

type RoleBudget = {
  maxOutputTokens: number;
  temperature?: number;
};

export type ModelLimits = {
  contextWindow: number;
  /** The efforts the provider's adapter puts on the wire for this model; empty sends none. */
  efforts: readonly Effort[];
  roles: Record<AgentRole, RoleBudget>;
};

const allEfforts: readonly Effort[] = ["low", "medium", "high", "max"];

// The per-role output reservation every source shares. A model counts its reasoning against it,
// so each holds reasoning plus the turn's longest write: a coder turn of six file writes was about
// 30000 tokens plus reasoning, and a degenerate turn runs to the cap, so coding is twice that. The
// Codex and xAI backends accept neither max_output_tokens nor temperature, and
// @corbits/codex-provider and @corbits/xai-provider omit both, so there these caps are not sent.
const sharedRoles: Record<AgentRole, RoleBudget> = {
  coordinator: { maxOutputTokens: 24576 },
  document: { maxOutputTokens: 32768 },
  coding: { maxOutputTokens: 65536 },
  design: { maxOutputTokens: 32768 },
};

// context_window of each model in the Codex CLI catalog, openai/codex@b1e72963c3
// codex-rs/models-manager/models.json (the catalog @corbits/codex-provider cites for
// CODEX_DEFAULT_MODELS). Every one lists low, medium and high; @corbits/codex-provider maps max
// to the model's highest listed level up to max. gpt-6.1-terra is not in that catalog; the ChatGPT
// login serves it, so it takes the same window as gpt-6.1-sol.
const codex = (contextWindow: number): ModelLimits => ({
  contextWindow,
  efforts: allEfforts,
  roles: sharedRoles,
});

// Grok takes a 500K window with up to 64K output, on the login proxy and the xAI API alike.
const xai: ModelLimits = {
  contextWindow: 500000,
  efforts: allEfforts,
  roles: sharedRoles,
};

// No role turn is measured on these models yet, so they take the shared reservations, here sent
// as max output, with no temperature. Claude: 1M window, 128K output including thinking
// (platform.claude.com models overview). Gemini: 1048576 input (Argon: input and output together)
// and 65536 output (ai.google.dev model pages). Both adapters put every effort on the wire.
// Claude's thinking counts against max_tokens. On 2026-10-30 an Opus designer spent the whole
// 32768 budget thinking through a mockup and wrote nothing, so its design turn gets twice that.
const claude: ModelLimits = {
  contextWindow: 1_000_000,
  efforts: allEfforts,
  roles: { ...sharedRoles, design: { maxOutputTokens: 65536 } },
};
const gemini: ModelLimits = {
  contextWindow: 1_048_576,
  efforts: allEfforts,
  roles: sharedRoles,
};

// The OpenAI API window is 1050000 with 128000 output, but input above 272000 is billed at twice
// the rate and output at 1.5x (developers.openai.com/api/docs/models), so the budget stops there.
// Every model takes all four efforts. Whether they accept temperature is unverified, so none is
// sent; the role caps are sent as max_output_tokens.
const openai: ModelLimits = {
  contextWindow: 272000,
  efforts: allEfforts,
  roles: sharedRoles,
};

const bySource: Record<string, ModelLimits> = {
  "openai\u0000gpt-6-astra": openai,
  "openai\u0000gpt-6.1-sol": openai,
  "openai\u0000gpt-6.1-terra": openai,
  "openai\u0000gpt-6-luna": openai,
  "anthropic\u0000claude-opus-5-5": claude,
  "anthropic\u0000claude-sonnet-5-5": claude,
  "anthropic\u0000claude-haiku-5-5": claude,
  "anthropic\u0000claude-fable-5-1": claude,
  "google\u0000gemini-4-argon": gemini,
  "google\u0000gemini-3.8-flash": gemini,
  "google\u0000gemini-3.5-flash-lite": gemini,
  "codex\u0000gpt-6.1-sol": codex(272000),
  "codex\u0000gpt-6.1-terra": codex(272000),
  "codex\u0000gpt-6-astra": codex(272000),
  "codex\u0000gpt-6-sol": codex(272000),
  "codex\u0000gpt-6-luna": codex(272000),
  "codex\u0000gpt-5.6-sol": codex(272000),
  "codex\u0000gpt-5.6-terra": codex(272000),
  "codex\u0000gpt-5.6-luna": codex(272000),
  "codex\u0000gpt-5.5": codex(272000),
  "xai\u0000grok-4.7": xai,
  "xai\u0000grok-4.7-build-fast": xai,
  "xai\u0000grok-4.6": xai,
  "xai\u0000grok-4.5": xai,
  "xai-api\u0000grok-4.7": xai,
  "xai-api\u0000grok-4.7-build-fast": xai,
  "xai-api\u0000grok-4.6": xai,
  "xai-api\u0000grok-4.5": xai,
};

export function modelLimits(
  provider: string,
  model: string,
): ModelLimits | undefined {
  const found = bySource[`${provider}\u0000${model}`];
  if (!found) return undefined;
  for (const role of Object.values(found.roles)) {
    if (
      role.maxOutputTokens <= 0 ||
      role.maxOutputTokens >= found.contextWindow
    )
      return undefined;
  }
  return found;
}

// A person's own model runs every role on the one output cap they set, and is sent no effort.
export function customModelLimits(model: CustomModel): ModelLimits {
  const budget: RoleBudget = { maxOutputTokens: model.maxOutputTokens };
  return {
    contextWindow: model.contextWindow,
    efforts: [],
    roles: {
      coordinator: budget,
      document: budget,
      coding: budget,
      design: budget,
    },
  };
}
