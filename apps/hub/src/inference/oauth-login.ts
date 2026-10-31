import {
  CODEX_PROVIDER,
  codexOAuthConfig,
  exchangeCodexCode,
  refreshCodexTokens,
} from "@corbits/codex-provider";
import {
  createOAuthTokenRefresher,
  mountOAuthLogin,
  type OAuthLoginProviders,
  type OAuthTokenRefresher,
} from "@corbits/oauth-core/hub";
import {
  exchangeXaiCode,
  refreshXaiTokens,
  XAI_PROVIDER,
  xaiOAuthConfig,
  xaiUserIdFromAccessToken,
} from "@corbits/xai-provider";
import type { DB } from "@intx/db";
import {
  createResolveTenant,
  requireAuth,
  type AppEnv,
  type RequireGrant,
  type TenantEnv,
} from "@intx/hub-api";
import { pushSourceUpdates, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import type { CredentialCipher } from "@intx/types";
import { Hono } from "hono";

const log = getLogger(["corbits-builder", "oauth-login"]);

type FetchLike = typeof fetch;

/**
 * The PKCE login, exchange and refresh each provider package supplies. Metadata carries the account
 * the backend wants named on every request; the installer copies it onto the offering's quirks,
 * because a catalog source carries no providerOptions.
 */
export function oauthModelProviders(
  fetchImpl: FetchLike = fetch,
): OAuthLoginProviders {
  return {
    [CODEX_PROVIDER]: {
      oauthConfig: codexOAuthConfig,
      exchange: (code, verifier, now) =>
        exchangeCodexCode(code, verifier, now, fetchImpl),
      refresh: (refreshSecret, now) =>
        refreshCodexTokens(refreshSecret, now, undefined, fetchImpl),
      metadata: (tokens) =>
        "accountId" in tokens && typeof tokens.accountId === "string"
          ? { accountId: tokens.accountId }
          : {},
    },
    [XAI_PROVIDER]: {
      oauthConfig: xaiOAuthConfig,
      exchange: (code, verifier, now) =>
        exchangeXaiCode(code, verifier, now, fetchImpl),
      refresh: (refreshSecret, now) =>
        refreshXaiTokens(refreshSecret, now, fetchImpl),
      metadata: (tokens) => {
        const userId = xaiUserIdFromAccessToken(tokens.access);
        return userId === undefined ? {} : { userId };
      },
    },
  };
}

/**
 * Mounts oauth-core's login routes under the tenant router and starts its refresher. Logins are
 * tenant-owned, the only credential a catalog model provider may use; starting one writes an
 * organizational credential, so it takes the same grant as the stock credential create.
 */
export function mountModelLogins(
  app: Hono<AppEnv>,
  options: {
    db: DB["db"];
    cipher: CredentialCipher;
    sidecarRouter: SidecarRouter;
    requireGrant: RequireGrant;
    fetchImpl?: FetchLike;
  },
): OAuthTokenRefresher {
  const providers = oauthModelProviders(options.fetchImpl);
  const tenantRoutes = new Hono<TenantEnv>();
  // Scoped to the login paths: this router is mounted at the tenant root beside other routers.
  for (const path of ["/oauth-logins", "/oauth-logins/*"])
    tenantRoutes.use(
      path,
      requireAuth,
      createResolveTenant({ db: options.db }),
    );
  mountOAuthLogin(tenantRoutes, {
    db: options.db,
    cipher: options.cipher,
    providers,
    requireGrant: options.requireGrant("credential:*", "create"),
    owner: "tenant",
    onError: (error, context) =>
      log.warn("Model login failed for {provider}: {error}", {
        provider: context.provider,
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  app.route("/api/tenants/:tenantId", tenantRoutes);
  const refresher = createOAuthTokenRefresher({
    db: options.db,
    cipher: options.cipher,
    providers,
    // A running sidecar holds the token it launched with; the stock rotation push re-resolves
    // the tenant's sources so it gets the refreshed one.
    onRefreshed: ({ tenantId }) =>
      pushSourceUpdates(
        options.db,
        options.sidecarRouter,
        tenantId,
        options.cipher,
      ),
    onError: (error, context) =>
      log.warn("Model token refresh failed for {credentialId}: {error}", {
        credentialId: context.credentialId ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  refresher.start();
  return refresher;
}
