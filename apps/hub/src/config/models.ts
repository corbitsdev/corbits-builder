import type {
  CustomApi,
  CustomModel,
  CustomProfile,
  Effort,
  ModelChoice,
  ModelRole,
  RoleBinding,
  Tier,
  Tiers,
} from "@corbits-builder/schemas/models";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import {
  customModelLimits,
  modelLimits,
  type AgentRole,
  type ModelLimits,
} from "../inference/model-limits.ts";

type CommonEntry = {
  // What a role binding names. Kept apart from the plugin so two entries can share a wire protocol.
  id: string;
  // The native catalog plugin that speaks this provider's wire protocol.
  plugin: string;
  label: string;
  hint: string;
  baseURL: string;
  // The adapter quirks every offering of this provider carries.
  quirks?: Readonly<Record<string, unknown>>;
  // The catalog capabilities every offering of this provider declares, for what its models take as input.
  capabilities?: readonly string[];
};

type ShippedEntry = Readonly<
  CommonEntry & {
    // How a person connects it: an API key they paste, or a subscription login run by the hub.
    kind: "api_key" | "login";
    // Each model needs a limits record in inference/model-limits.ts before a role can run on it.
    models: readonly Readonly<{ id: string; label: string }>[];
  }
>;

// A person's own endpoint: its id is Builder's, so it outlives the catalog connection it currently
// runs on, and its models carry their own limits.
type CustomEntry = Readonly<
  CommonEntry & {
    kind: "custom";
    // The catalog model provider it runs on.
    connection: string;
    keyless: boolean;
    models: readonly CustomModel[];
  }
>;

export type ProviderEntry = ShippedEntry | CustomEntry;

// The model providers a person can connect. Adding a provider is one entry here with at least one
// model; adding a model is one entry in its `models` and one limits record. A provider no role can
// run on is not listed, so connecting it is never offered.
export const MODEL_PROVIDERS: readonly ShippedEntry[] = [
  {
    id: "openai",
    plugin: "openai-responses",
    kind: "api_key",
    label: "OpenAI",
    hint: "An OpenAI API key.",
    baseURL: "https://api.openai.com/v1",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
    // All four take reasoning effort max (developers.openai.com/api/docs/models); unset, the
    // adapter sends high for it.
    quirks: { reasoning: { maxEffort: "max" } },
  },
  {
    id: "anthropic",
    plugin: "anthropic",
    kind: "api_key",
    label: "Anthropic",
    hint: "An Anthropic API key.",
    baseURL: "https://api.anthropic.com",
    models: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    ],
    // Every Claude model reads images and PDFs (docs.anthropic.com).
    capabilities: [
      "vision-input",
      "vision-input-streaming",
      "document-input",
      "document-input-streaming",
    ],
  },
  {
    id: "google",
    plugin: "google-genai",
    kind: "api_key",
    label: "Google",
    hint: "A Gemini API key.",
    baseURL: "https://generativelanguage.googleapis.com",
    models: [
      { id: "gemini-4-argon", label: "Gemini 4 Argon" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    ],
  },
  {
    id: "xai-api",
    plugin: "openai-responses",
    kind: "api_key",
    quirks: { reasoning: { maxEffort: "xhigh" } },
    label: "xAI API",
    hint: "An xAI API key, from console.x.ai.",
    baseURL: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.7-build-fast", label: "Grok 4.7 Build Fast" },
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
    ],
    // Grok reads images as well as text.
    capabilities: ["vision-input", "vision-input-streaming"],
  },
  // The models @corbits/codex-provider and @corbits/xai-provider serve that have a limits record,
  // at the only endpoints their login tokens work on (CODEX_BASE_URL, XAI_OAUTH_PROXY_BASE_URL).
  {
    id: "codex",
    plugin: "codex",
    kind: "login",
    label: "ChatGPT",
    hint: "Your ChatGPT subscription, signed in through OpenAI.",
    baseURL: "https://chatgpt.com/backend-api",
    models: [
      { id: "gpt-6.1-sol", label: "gpt-6.1-sol" },
      { id: "gpt-6.1-terra", label: "gpt-6.1-terra" },
      { id: "gpt-6-astra", label: "gpt-6-astra" },
      { id: "gpt-6-sol", label: "gpt-6-sol" },
      { id: "gpt-6-luna", label: "gpt-6-luna" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
      { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
      { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
      { id: "gpt-5.5", label: "gpt-5.5" },
    ],
  },
  {
    id: "xai",
    plugin: "xai",
    kind: "login",
    label: "xAI",
    hint: "Your xAI subscription, signed in through xAI.",
    baseURL: "https://cli-chat-proxy.grok.com/v1",
    models: [
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.7-build-fast", label: "Grok 4.7 Build Fast" },
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
    ],
    // Grok reads images as well as text.
    capabilities: ["vision-input", "vision-input-streaming"],
  },
];

// The APIs a custom provider can speak, each served by the native adapter of that plugin.
export const CUSTOM_APIS: Readonly<Record<CustomApi, string>> = {
  "openai-compatible": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
};

/** The providers a workspace can bind roles to: the shipped ones, then each custom provider. */
export type ModelDirectory = readonly ProviderEntry[];

export function modelProvider(
  directory: ModelDirectory,
  id: string,
): ProviderEntry | undefined {
  return directory.find((entry) => entry.id === id);
}

/** The shipped entry a catalog provider row is a connection of: the one at its plugin and base URL. */
export function shippedOfRow(
  row: Readonly<{ plugin: string; baseURL: string | undefined }>,
): ShippedEntry | undefined {
  return MODEL_PROVIDERS.find(
    (entry) => entry.plugin === row.plugin && entry.baseURL === row.baseURL,
  );
}

/** The custom provider running on a catalog provider row, else the shipped entry it connects. */
export function providerOfRow(
  directory: ModelDirectory,
  row: Readonly<{ id: string; plugin: string; baseURL: string }>,
): ProviderEntry | undefined {
  return (
    directory.find(
      (entry) => entry.kind === "custom" && entry.connection === row.id,
    ) ?? shippedOfRow(row)
  );
}

/** The limits a role runs a bound model with: a custom model's own, else its shipped record. */
export function bindingLimits(
  directory: ModelDirectory,
  provider: string,
  model: string,
): ModelLimits | undefined {
  const entry = modelProvider(directory, provider);
  if (entry?.kind !== "custom") return modelLimits(provider, model);
  const offered = entry.models.find((candidate) => candidate.id === model);
  return offered && customModelLimits(offered);
}

// Each role a profile binds, the tier it runs on, the workflow that runs it, and the limits record
// it budgets by. A person picks only a profile; the tier of each role is config.
export const MODEL_ROLES: readonly Readonly<{
  id: ModelRole;
  label: string;
  hint: string;
  tier: Tier;
  workflow: WorkflowRole;
  limits: AgentRole;
}>[] = [
  {
    id: "coordinator",
    label: "Coordinator",
    hint: "Talks with you and plans the work.",
    tier: "medium",
    workflow: "coordinator",
    limits: "coordinator",
  },
  {
    id: "writer",
    label: "Writer",
    hint: "Writes the documents.",
    tier: "medium",
    workflow: "writer",
    limits: "document",
  },
  {
    id: "designer",
    label: "Designer",
    hint: "Designs the screens.",
    tier: "high",
    workflow: "designer",
    limits: "design",
  },
  {
    id: "builder",
    label: "App builder",
    hint: "Builds the app.",
    tier: "high",
    workflow: "coder",
    limits: "coding",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    hint: "Reviews documents before you approve them.",
    tier: "low",
    workflow: "reviewer",
    limits: "document",
  },
];

export const EFFORTS: readonly Readonly<{ id: Effort; label: string }>[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
];

export const TIERS: readonly Readonly<{ id: Tier; label: string }>[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
];

type Profile = Readonly<{
  id: string;
  label: string;
  hint: string;
  tiers: Readonly<Tiers>;
}>;

// A provider's shipped profile, `<name>_default`: each tier's model and reasoning effort.
function shipped(
  name: string,
  provider: string,
  label: string,
  hint: string,
  tiers: Readonly<Record<Tier, readonly [model: string, effort: Effort]>>,
): Profile {
  return {
    id: `${name}_default`,
    label: `${label} Default`,
    hint,
    tiers: Object.fromEntries(
      Object.entries(tiers).map(([tier, [model, effort]]) => [
        tier,
        { provider, model, effort },
      ]),
    ) as Tiers,
  };
}

// The shipped profiles, one per provider. A person picks one in Settings or makes their own; a
// project keeps the bindings it started with. The xAI API's max tier reaches Grok as xhigh, its
// reasoning quirk; the xAI login's max tier sends high.
export const PROFILES: readonly Profile[] = [
  shipped(
    "anthropic",
    "anthropic",
    "Anthropic",
    "Haiku reviews, Sonnet writes, Opus designs and builds.",
    {
      low: ["claude-haiku-5-5", "medium"],
      medium: ["claude-sonnet-5-5", "medium"],
      high: ["claude-opus-5-5", "medium"],
      max: ["claude-opus-5-5", "max"],
    },
  ),
  shipped(
    "openai",
    "openai",
    "OpenAI",
    "Luna reviews, Terra writes, Sol designs and builds.",
    {
      low: ["gpt-6-luna", "medium"],
      medium: ["gpt-6.1-terra", "high"],
      high: ["gpt-6.1-sol", "high"],
      max: ["gpt-6-astra", "max"],
    },
  ),
  shipped(
    "codex",
    "codex",
    "ChatGPT",
    "Luna reviews, Terra writes, Sol designs and builds.",
    {
      low: ["gpt-6-luna", "medium"],
      medium: ["gpt-6.1-terra", "high"],
      high: ["gpt-6.1-sol", "high"],
      max: ["gpt-6-astra", "max"],
    },
  ),
  shipped(
    "google",
    "google",
    "Google",
    "Flash-Lite reviews, Flash writes, Argon designs and builds.",
    {
      low: ["gemini-3.5-flash-lite", "medium"],
      medium: ["gemini-3.8-flash", "medium"],
      high: ["gemini-4-argon", "medium"],
      max: ["gemini-4-argon", "max"],
    },
  ),
  shipped(
    "xai",
    "xai",
    "xAI",
    "Grok 4.7 throughout, from low effort up to high.",
    {
      low: ["grok-4.7", "low"],
      medium: ["grok-4.7", "medium"],
      high: ["grok-4.7", "high"],
      max: ["grok-4.7", "max"],
    },
  ),
  shipped(
    "xai_api",
    "xai-api",
    "xAI API",
    "Grok 4.7 throughout, from low effort up to xhigh.",
    {
      low: ["grok-4.7", "low"],
      medium: ["grok-4.7", "medium"],
      high: ["grok-4.7", "high"],
      max: ["grok-4.7", "max"],
    },
  ),
];
/** Why a binding cannot run: an unlisted provider or model, or a model without limits. */
function unrunnable(
  directory: ModelDirectory,
  binding: RoleBinding,
): string | undefined {
  const provider = modelProvider(directory, binding.provider);
  if (!provider) return `provider:${binding.provider}`;
  if (!provider.models.some((model) => model.id === binding.model))
    return `model:${binding.provider}:${binding.model}`;
  if (!bindingLimits(directory, binding.provider, binding.model))
    return `limits:${binding.provider}:${binding.model}`;
  return undefined;
}

for (const profile of PROFILES)
  for (const binding of Object.values(profile.tiers)) {
    const reason = unrunnable(MODEL_PROVIDERS, binding);
    if (reason) throw new Error(`profile_unrunnable:${profile.id}:${reason}`);
  }

/** The first part of a choice the profiles cannot run: its profile or a made profile's tier. */
export function invalidModelChoice(
  directory: ModelDirectory,
  choice: ModelChoice,
): string | undefined {
  const custom = choice.custom ?? [];
  const ids = [...PROFILES, ...custom].map((profile) => profile.id);
  if (new Set(ids).size !== ids.length) return "duplicate_profile";
  if (choice.profile !== undefined && !ids.includes(choice.profile))
    return choice.profile;
  // A made profile nobody runs may name a provider since removed; only the chosen one must run.
  const chosen = custom.find((profile) => profile.id === choice.profile);
  if (chosen) {
    for (const [tier, binding] of Object.entries(chosen.tiers)) {
      const reason = unrunnable(directory, binding);
      if (reason) return `${chosen.id}:${tier}:${reason}`;
    }
  }
  return undefined;
}

/** The profile a choice names, when this server can run every tier of it. */
function chosenProfile(
  directory: ModelDirectory,
  choice: ModelChoice | null,
): CustomProfile | undefined {
  const profile =
    choice?.custom?.find((entry) => entry.id === choice.profile) ??
    PROFILES.find((entry) => entry.id === choice?.profile);
  return profile &&
    Object.values(profile.tiers).every(
      (binding) => !unrunnable(directory, binding),
    )
    ? profile
    : undefined;
}

export type ModelChoiceRefusal =
  | "model_provider_missing"
  | "model_profile_required"
  | "model_profile_custom";

// Why a project's coordinator cannot start without a model profile, as the API and UI show it.
export const MODEL_CHOICE_REFUSALS: Readonly<
  Record<ModelChoiceRefusal, string>
> = {
  model_provider_missing:
    "No model provider is configured. Connect one in Settings, Providers, and the coordinator can start.",
  model_profile_required:
    "More than one model provider is connected. Choose a model profile in Settings, Profiles, and the coordinator can start.",
  model_profile_custom:
    "Only custom providers are connected, and they have no ready-made profile. Make a profile for your custom models in Settings, Profiles, and the coordinator can start.",
};

/**
 * The profile a project runs on: the person's choice when this server can run it, else the shipped
 * profile of the only connected provider. With none connected, or several and no runnable choice,
 * there is no profile.
 */
export function resolveModelChoice(
  directory: ModelDirectory,
  choice: ModelChoice | null,
  connected: readonly string[],
): { choice: ModelChoice } | { refused: ModelChoiceRefusal } {
  const chosen = chosenProfile(directory, choice);
  if (chosen) return { choice: frozen(chosen) };
  const providers = [...new Set(connected)];
  const only =
    providers.length === 1 ? shippedProfileOf(providers[0]!) : undefined;
  if (only) return { choice: frozen(only) };
  if (providers.length === 0) return { refused: "model_provider_missing" };
  return {
    refused: providers.every(
      (id) => modelProvider(directory, id)?.kind === "custom",
    )
      ? "model_profile_custom"
      : "model_profile_required",
  };
}

/** The shipped profile whose every tier runs on this provider. */
function shippedProfileOf(provider: string): Profile | undefined {
  return PROFILES.find((profile) =>
    Object.values(profile.tiers).every(
      (binding) => binding.provider === provider,
    ),
  );
}

/** A person's choice switched to one of their profiles. Null when no such profile exists. */
export function pickedModelChoice(
  choice: ModelChoice | null,
  profile: string,
): ModelChoice | null {
  const custom = choice?.custom ?? [];
  if (![...PROFILES, ...custom].some((entry) => entry.id === profile))
    return null;
  return { profile, ...(custom.length ? { custom } : {}) };
}

/** The choice a project keeps: its profile with every tier written out. */
function frozen(profile: CustomProfile): ModelChoice {
  return {
    profile: profile.id,
    custom: [{ id: profile.id, label: profile.label, tiers: profile.tiers }],
  };
}

/** The frozen choice of a runnable choice; null when this server cannot run it. */
export function frozenModelChoice(
  directory: ModelDirectory,
  choice: ModelChoice | null,
): ModelChoice | null {
  const profile = chosenProfile(directory, choice);
  return profile ? frozen(profile) : null;
}

/** The binding each workflow runs on, from a choice this server can run. */
export function workflowBindings(
  directory: ModelDirectory,
  choice: ModelChoice,
): Record<WorkflowRole, RoleBinding> {
  const profile = chosenProfile(directory, choice);
  if (!profile)
    throw new Error(`model_choice_unrunnable:${choice.profile ?? ""}`);
  return Object.fromEntries(
    MODEL_ROLES.map((role) => [role.workflow, profile.tiers[role.tier]]),
  ) as Record<WorkflowRole, RoleBinding>;
}

export function limitsRole(workflow: WorkflowRole): AgentRole {
  return MODEL_ROLES.find((role) => role.workflow === workflow)!.limits;
}
