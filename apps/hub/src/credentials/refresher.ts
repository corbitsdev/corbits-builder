/**
 * Renews the hub's oauth_token credentials, model logins and plugin sign-ins alike, before they
 * expire. One timer renews them all, each through the provider entry its credential's
 * `oauthProvider` names, and the new token is pushed to every run that has the old one.
 */
import {
  createOAuthRefreshStore,
  createRefreshTicker,
  type OAuthLoginProviders,
  type OAuthRefreshStore,
} from "@corbits/oauth-core/hub";
import type { OAuthLoginProvider } from "@corbits/oauth-core";
import type { DB } from "@intx/db";
import { credential } from "@intx/db/schema";
import { getLogger } from "@intx/log";
import type { CredentialCipher } from "@intx/types";
import { credentialProvider } from "@corbits-builder/plugin";
import { inArray } from "drizzle-orm";

const log = getLogger(["corbits-builder", "token-refresh"]);

// The prefix of every plugin credential's provider key.
const PLUGIN = credentialProvider("");

/** The name of each of the given credentials, by id. */
export type CredentialNames = (
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/**
 * The rows due for renewal that name a provider the hub registered. For a row that names none, the
 * library would renew with the client and token address in the row's metadata. Anyone who may
 * manage the credential can write that metadata, and so send its refresh token anywhere. The hub
 * registers every provider it signs in with, so it renews only those. A plugin's sign-in is also
 * renewed only under its own name, because the provider a row names is in the same editable
 * metadata. Pointed at another plugin's entry, it would send this token to that plugin's token
 * address.
 */
export const registeredOnly = (
  store: OAuthRefreshStore,
  providers: OAuthLoginProviders,
  namesOf: CredentialNames,
): OAuthRefreshStore => ({
  ...store,
  listDue: async (dueBefore, keys) => {
    const registered = (await store.listDue(dueBefore, keys)).filter(
      ({ provider }) => Object.hasOwn(providers, provider),
    );
    const signedIn = registered.filter(({ provider }) =>
      provider.startsWith(PLUGIN),
    );
    const names =
      signedIn.length === 0
        ? new Map<string, string>()
        : await namesOf(signedIn.map(({ id }) => id));
    return registered.filter(
      ({ id, provider }) =>
        !provider.startsWith(PLUGIN) || names.get(id) === provider,
    );
  },
});

/** The names the database has for the credentials with those ids. */
export const credentialNames =
  (db: DB["db"]): CredentialNames =>
  async (ids) =>
    new Map(
      (
        await db
          .select({ id: credential.id, name: credential.name })
          .from(credential)
          .where(inArray(credential.id, [...ids]))
      ).map(({ id, name }) => [id, name]),
    );

/**
 * Starts the refresher. The hub's own routes start and finish a plugin sign-in, so its provider
 * entry has only the refresh call. The library's login config and exchange are left out, because
 * the refresher never reads them.
 */
export function startTokenRefresher(options: {
  db: DB["db"];
  cipher: CredentialCipher;
  models: OAuthLoginProviders;
  signIns: Readonly<Record<string, Pick<OAuthLoginProvider, "refresh">>>;
  pushRenewed: (tenantId: string, credentialId: string) => Promise<void>;
}) {
  const providers: OAuthLoginProviders = {
    ...options.models,
    ...(options.signIns as OAuthLoginProviders),
  };
  const store = createOAuthRefreshStore({
    db: options.db,
    cipher: options.cipher,
  });
  const refresher = createRefreshTicker(
    registeredOnly(store, providers, credentialNames(options.db)),
    {
      providers,
      onRefreshed: ({ tenantId, credentialId }) =>
        options.pushRenewed(tenantId, credentialId),
      onError: (error, context) =>
        // A plugin's token endpoint may return more than a code; only the kind of failure is kept.
        context.provider?.startsWith(PLUGIN)
          ? log.warn("Sign-in refresh failed for {credentialId}: {failure}", {
              credentialId: context.credentialId ?? "unknown",
              failure: error instanceof Error ? error.name : "unknown",
            })
          : log.warn("Model token refresh failed for {credentialId}: {error}", {
              credentialId: context.credentialId ?? "unknown",
              error: error instanceof Error ? error.message : String(error),
            }),
    },
  );
  refresher.start();
  return refresher;
}
