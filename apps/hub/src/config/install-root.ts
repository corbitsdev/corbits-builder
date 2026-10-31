import type { Environment } from "../environment.ts";

// The install's root tenant: every workspace is created under it, so what it owns (the server's
// provider keys) every workspace and project inherits.
export const installRoot = Object.freeze({
  slug: "builder-install",
  name: "Builder install",
  // The only authority a person holds in the root: making a workspace under it.
  creatorRole: "workspace-creator",
  connectionNote: "From the server environment",
});

// Each server environment key and the provider entry (config/models.ts) it connects.
const SERVER_PROVIDER_KEYS = [
  { env: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { env: "OPENAI_API_KEY", provider: "openai" },
  { env: "GEMINI_API_KEY", provider: "google" },
  { env: "XAI_API_KEY", provider: "xai-api" },
] as const;

const UNSUPPORTED_PROVIDER_KEYS = ["OPENCODE_API_KEY", "ZAI_API_KEY"] as const;

type ServerProviderKey = Readonly<{
  env: string;
  provider: string;
  secret: string;
  baseURL?: string;
}>;

export type ServerProviderKeys = Readonly<{
  enabled: boolean;
  keys: readonly ServerProviderKey[];
  unsupported: readonly string[];
}>;

/** The provider keys the server environment sets; SERVER_PROVIDER_KEYS=false turns seeding off. */
export function readServerProviderKeys(
  environment: Environment,
): ServerProviderKeys {
  const flag = environment["SERVER_PROVIDER_KEYS"] ?? "true";
  if (flag !== "true" && flag !== "false")
    throw new Error("SERVER_PROVIDER_KEYS must be true or false.");
  const set = (name: string) => Boolean(environment[name]?.trim());
  return {
    enabled: flag === "true",
    keys: SERVER_PROVIDER_KEYS.filter(({ env }) => set(env)).map(
      ({ env, provider }) => ({
        env,
        provider,
        secret: environment[env]!.trim(),
      }),
    ),
    unsupported: UNSUPPORTED_PROVIDER_KEYS.filter(set),
  };
}
