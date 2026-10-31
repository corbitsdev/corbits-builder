import { productConfig } from "../config/index.ts";

// The adapter plugins @corbits/codex-provider and @corbits/xai-provider register (CODEX_PROVIDER,
// XAI_PROVIDER). Named here so the installer reads them without loading those packages.
const OAUTH_MODEL_PLUGINS = ["codex", "xai"] as const;
export type OAuthModelPlugin = (typeof OAUTH_MODEL_PLUGINS)[number];

export function isOAuthModelPlugin(plugin: string): plugin is OAuthModelPlugin {
  return (OAUTH_MODEL_PLUGINS as readonly string[]).includes(plugin);
}

/**
 * The adapter quirks an offering of this plugin needs: the host identity Codex requires, and the
 * account the backend wants named on every request, copied from the login's credential metadata
 * because a catalog source carries no providerOptions.
 */
export function offeringQuirks(
  plugin: OAuthModelPlugin,
  metadata: Record<string, unknown> | null,
): Record<string, string> {
  const named = (key: string) => {
    const value = metadata?.[key];
    return typeof value === "string" ? value : undefined;
  };
  if (plugin === "codex") {
    const accountId = named("accountId");
    return {
      productName: productConfig.naming.productName,
      environmentTagName: "builder_environment",
      ...(accountId !== undefined ? { accountId } : {}),
    };
  }
  const userId = named("userId");
  return userId !== undefined ? { userId } : {};
}
