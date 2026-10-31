import { type } from "arktype";

const name = type("string > 0").atMostLength(200);

export const ProviderStatus = type(
  "'connected' | 'unconfigured' | 'unavailable' | 'refused'",
);
export type ProviderStatus = typeof ProviderStatus.infer;

// A key is tried once against the provider's model list before it is kept; it is never returned.
export const ProviderTest = type({
  "+": "reject",
  plugin: name,
  "baseURL?": type("string").atMostLength(2000),
  secret: type("string > 0").atMostLength(8000),
});
export type ProviderTest = typeof ProviderTest.infer;
export const ProviderTestResult = type({
  "+": "reject",
  status: ProviderStatus,
});
export type ProviderTestResult = typeof ProviderTestResult.infer;

export const ModelProvider = type({
  "+": "reject",
  id: name,
  plugin: name,
  kind: "'api_key' | 'login'",
  label: name,
  hint: name,
  needsBaseUrl: "boolean",
  baseURL: "string",
  models: type({ "+": "reject", id: name, label: name }).array(),
  connections: type({
    "+": "reject",
    id: name,
    name,
    status: ProviderStatus,
    credentialSet: "boolean",
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
