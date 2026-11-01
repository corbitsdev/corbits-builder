import { type } from "arktype";

const name = type("string > 0").atMostLength(200);

export const ProviderStatus = type(
  "'connected' | 'unconfigured' | 'unavailable' | 'refused'",
);
export type ProviderStatus = typeof ProviderStatus.infer;

const testTarget = {
  "+": "reject",
  plugin: name,
  "baseURL?": type("string").atMostLength(2000),
} as const;
// A key is tried once against the provider's model list before it is kept; it is never returned.
// A keyless server is tried with no key at all.
export const ProviderTest = type({
  ...testTarget,
  secret: type("string > 0").atMostLength(8000),
}).or({ ...testTarget, keyless: "true" });
export type ProviderTest = typeof ProviderTest.infer;
export const ProviderTestResult = type({
  "+": "reject",
  status: ProviderStatus,
});
export type ProviderTestResult = typeof ProviderTestResult.infer;

const tokens = type("number.integer > 0").atMost(100_000_000);

// A model a person serves from their own endpoint, with the window and output cap every role runs it with.
export const CustomModel = type({
  "+": "reject",
  id: name,
  // The name a person gave it; without one it is shown by its id.
  "label?": name,
  contextWindow: tokens,
  maxOutputTokens: tokens,
}).narrow(
  (model, ctx) =>
    model.maxOutputTokens < model.contextWindow ||
    ctx.mustBe("an output cap below the context window"),
);
export type CustomModel = typeof CustomModel.infer;

// The wire API a custom provider speaks, named by the native adapter plugin that serves it.
export const CustomApi = type(
  "'openai-compatible' | 'openai-responses' | 'anthropic'",
);
export type CustomApi = typeof CustomApi.infer;

const customModels = CustomModel.array()
  .atLeastLength(1)
  .atMostLength(50)
  .narrow(
    (models, ctx) =>
      new Set(models.map((model) => model.id)).size === models.length ||
      ctx.mustBe("models with distinct ids"),
  );

// A key is pinned to the origin it was entered for, so a new base URL, API or key is a new connection.
const endpoint = {
  "+": "reject",
  api: CustomApi,
  baseURL: type("string.url").atMostLength(2000),
} as const;
// A server that needs no key is marked keyless instead of given one.
const CustomConnection = type({
  ...endpoint,
  secret: type("string > 0").atMostLength(8000),
}).or({ ...endpoint, keyless: "true" });

export const CustomProviderCreate = type({
  "+": "reject",
  name,
  models: customModels,
  connection: CustomConnection,
});
export type CustomProviderCreate = typeof CustomProviderCreate.infer;

export const CustomProviderUpdate = type({
  "+": "reject",
  name,
  models: customModels,
  "connection?": CustomConnection,
});
export type CustomProviderUpdate = typeof CustomProviderUpdate.infer;

export const CustomProviderReceipt = type({ "+": "reject", id: name });
export type CustomProviderReceipt = typeof CustomProviderReceipt.infer;

export const ModelProvider = type({
  "+": "reject",
  id: name,
  plugin: name,
  kind: "'api_key' | 'login' | 'custom'",
  label: name,
  hint: name,
  needsBaseUrl: "boolean",
  baseURL: "string",
  models: type({ "+": "reject", id: name, label: name })
    .or(CustomModel)
    .array(),
  connections: type({
    "+": "reject",
    id: name,
    name,
    // Omitted for a custom endpoint, which is probed only on demand, unless it is disabled.
    "status?": ProviderStatus,
    credentialSet: "boolean",
    // A custom endpoint's: whether it runs with no key.
    "keyless?": "boolean",
    // Where the connection comes from when a person did not make it, such as the server's keys.
    "note?": "string",
  }).array(),
});
export type ModelProvider = typeof ModelProvider.infer;

export const Effort = type("'low' | 'medium' | 'high' | 'max'");
export type Effort = typeof Effort.infer;
export const ModelRole = type(
  "'coordinator' | 'writer' | 'designer' | 'builder' | 'reviewer'",
);
export type ModelRole = typeof ModelRole.infer;
export const Tier = type("'low' | 'medium' | 'high' | 'max'");
export type Tier = typeof Tier.infer;
export const RoleBinding = type({
  "+": "reject",
  provider: name,
  model: name,
  effort: Effort,
});
export type RoleBinding = typeof RoleBinding.infer;
export const Tiers = type({
  "+": "reject",
  low: RoleBinding,
  medium: RoleBinding,
  high: RoleBinding,
  max: RoleBinding,
});
export type Tiers = typeof Tiers.infer;

export const ProfileId = type(/^[a-z][a-z0-9_]{0,63}$/);

export const CustomProfile = type({
  "+": "reject",
  id: ProfileId,
  label: name,
  tiers: Tiers,
});
export type CustomProfile = typeof CustomProfile.infer;

// No profile means the person has not chosen one; a project then runs on the only connected
// provider's profile, or waits for a choice.
export const ModelChoice = type({
  "+": "reject",
  "profile?": ProfileId,
  "custom?": CustomProfile.array().atMostLength(50),
});
export type ModelChoice = typeof ModelChoice.infer;

type LegacyRoles = Partial<Record<ModelRole, RoleBinding>>;
const legacyTiers = (roles: LegacyRoles) => ({
  low: roles.reviewer,
  medium: roles.coordinator,
  high: roles.builder,
  max: roles.builder,
});

// A choice stored before profiles had tiers carries per-role `overrides`. A shipped id with a
// provider (`anthropic_high`) names that provider's default profile now, and a project's frozen overrides,
// which bound every role, become its profile's tiers by the tier each role is pinned to.
function migrated(raw: Record<string, unknown>): unknown {
  if (!("overrides" in raw)) return raw;
  const { profile, overrides, custom } = raw as {
    profile: string;
    overrides: LegacyRoles;
    custom?: { id: string; label: string; roles: LegacyRoles }[];
  };
  const made = (custom ?? []).map(({ id, label, roles }) => ({
    id,
    label,
    tiers: legacyTiers(roles),
  }));
  const shipped = /^(?:([a-z][a-z0-9]*)_)?(?:low|medium|high|max)$/.exec(
    profile,
  );
  const id =
    shipped?.[1] && !made.some((entry) => entry.id === profile)
      ? `${shipped[1]}_default`
      : profile;
  const roles: readonly ModelRole[] = [
    "coordinator",
    "writer",
    "designer",
    "builder",
    "reviewer",
  ];
  if (roles.every((role) => overrides[role])) {
    const label = made.find((entry) => entry.id === id)?.label ?? id;
    return {
      profile: id,
      custom: [{ id, label, tiers: legacyTiers(overrides) }],
    };
  }
  return { profile: id, ...(made.length ? { custom: made } : {}) };
}

export const StoredModelChoice = type("Record<string, unknown>").pipe(
  migrated,
  ModelChoice,
);

export const ModelCatalog = type({
  "+": "reject",
  providers: ModelProvider.array(),
  roles: type({
    "+": "reject",
    id: ModelRole,
    label: name,
    hint: name,
    tier: Tier,
  }).array(),
  tiers: type({ "+": "reject", id: Tier, label: name }).array(),
  efforts: type({ "+": "reject", id: Effort, label: name }).array(),
  // The APIs a custom provider can speak.
  customApis: type({ "+": "reject", id: CustomApi, label: name }).array(),
  // The profile a person without a choice runs on: the only connected provider's.
  "automaticProfile?": name,
  // Why there is no automatic profile, when there is none.
  "unresolved?": type({ "+": "reject", code: name, message: name }),
  profiles: type({
    "+": "reject",
    id: name,
    label: name,
    hint: name,
    tiers: Tiers,
    // Every provider its tiers run on has a connection that answered.
    available: "boolean",
  }).array(),
});
export type ModelCatalog = typeof ModelCatalog.infer;
