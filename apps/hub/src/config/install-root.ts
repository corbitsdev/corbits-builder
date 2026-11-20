import type { HubEnvironment } from "../environment.ts";

// The install's root tenant. Every workspace is created under it, so every workspace and project
// inherits what it owns: the server's provider keys.
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
export function serverProviderKeys(
  environment: Pick<
    HubEnvironment,
    | "SERVER_PROVIDER_KEYS"
    | (typeof SERVER_PROVIDER_KEYS)[number]["env"]
    | (typeof UNSUPPORTED_PROVIDER_KEYS)[number]
  >,
): ServerProviderKeys {
  return {
    enabled: environment.SERVER_PROVIDER_KEYS,
    keys: SERVER_PROVIDER_KEYS.flatMap((key) => {
      const secret = environment[key.env];
      return secret === undefined
        ? []
        : [{ env: key.env, provider: key.provider, secret }];
    }),
    unsupported: UNSUPPORTED_PROVIDER_KEYS.filter(
      (name) => environment[name] !== undefined,
    ),
  };
}
