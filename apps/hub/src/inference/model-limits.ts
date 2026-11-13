// One record per provider entry (config/models.ts) and model. Adding a model is a record here.
// The window includes the reserved completion. The output budget a role runs with is its plugin's
// (an OutputBudget), and stays below the window so the prompt still fits. A missing record fails
// closed. How hard each role reasons is the profile's choice (config/models.ts), not the model's.
// A model counts its reasoning against a budget's cap. The Codex and xAI backends accept neither
// max_output_tokens nor temperature, and @corbits/codex-provider and @corbits/xai-provider omit
// both, so there the caps are not sent.

import type { OutputBudget } from "@corbits-builder/plugin";
import type { CustomModel } from "@corbits-builder/schemas/models";

type Effort = "low" | "medium" | "high" | "max";

export type ModelLimits = {
  contextWindow: number;
  /** The efforts the provider's adapter puts on the wire for this model; empty sends none. */
  efforts: readonly Effort[];
  // It may spend a whole output cap thinking, so a budget's thinking cap is the one it runs with.
  thinksLong?: true;
  // A person's own model runs every budget on the one output cap they set.
  maxOutputTokens?: number;
};

const allEfforts: readonly Effort[] = ["low", "medium", "high", "max"];

// context_window of each model in the Codex CLI catalog, openai/codex@b1e72963c3
// codex-rs/models-manager/models.json (the catalog @corbits/codex-provider cites for
// CODEX_DEFAULT_MODELS). Every one lists low, medium and high; @corbits/codex-provider maps max
// to the model's highest listed level up to max. gpt-6.1-terra is not in that catalog; the ChatGPT
// login serves it, so it takes the same window as gpt-6.1-sol.
const codex = (contextWindow: number): ModelLimits => ({
  contextWindow,
  efforts: allEfforts,
});

// Grok takes a 500K window with up to 64K output, on the login proxy and the xAI API alike.
const xai: ModelLimits = {
  contextWindow: 500000,
  efforts: allEfforts,
};

// No role turn is measured on these models yet, so they take the budgets' caps, here sent as max
// output, with no temperature. Claude: 1M window, 128K output including thinking
// (platform.claude.com models overview). Gemini: 1048576 input (Argon: input and output together)
// and 65536 output (ai.google.dev model pages). Both adapters put every effort on the wire.
// Claude's thinking counts against max_tokens, and a designer can spend a whole budget thinking
// through a mockup and write nothing, so it runs a budget's thinking cap.
const claude: ModelLimits = {
  contextWindow: 1_000_000,
  efforts: allEfforts,
  thinksLong: true,
};
const gemini: ModelLimits = {
  contextWindow: 1_048_576,
  efforts: allEfforts,
};

// The OpenAI API window is 1050000 with 128000 output, but input above 272000 is billed at twice
// the rate and output at 1.5x (developers.openai.com/api/docs/models), so the budget stops there.
// Every model takes all four efforts. Whether they accept temperature is unverified, so none is
// sent; the role caps are sent as max_output_tokens.
const openai: ModelLimits = {
  contextWindow: 272000,
  efforts: allEfforts,
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
  return bySource[`${provider}\u0000${model}`];
}

// A person's own model runs every budget on the one output cap they set, and is sent no effort.
export function customModelLimits(model: CustomModel): ModelLimits {
  return {
    contextWindow: model.contextWindow,
    efforts: [],
    maxOutputTokens: model.maxOutputTokens,
  };
}

/** The output cap and temperature a budget runs with on a model. */
export function budgetOn(
  limits: ModelLimits,
  budget: OutputBudget,
): { maxOutputTokens: number; temperature?: number } {
  if (limits.maxOutputTokens !== undefined)
    return { maxOutputTokens: limits.maxOutputTokens };
  const maxOutputTokens =
    limits.thinksLong && budget.thinking !== undefined
      ? budget.thinking
      : budget.maxOutputTokens;
  if (budget.temperature === undefined) return { maxOutputTokens };
  return { maxOutputTokens, temperature: budget.temperature };
}
