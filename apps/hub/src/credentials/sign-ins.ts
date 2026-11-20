/**
 * Signing in at a plugin's provider instead of pasting its key. The hub starts the sign-in and the
 * person signs in on the provider's page in a separate tab. The provider sends that tab back to the
 * hub's callback with a code, and the hub exchanges the code for tokens and saves them as the
 * plugin's credential in the project. Every address the hub sends a code, a token or the person to
 * comes from the installed plugin's manifest, never from a request or a credential row. The PKCE
 * verifier stays in this process. No answer, error or log line contains a code, a token or a
 * verifier: failures are fixed codes.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  baseTokensFromResponse,
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  generateState,
  OAuthMissingRefreshTokenError,
  OAuthTokenEndpointError,
  refreshTokenRequest,
  registerMcpClient,
  type OAuthClientConfig,
  type OAuthLoginProvider,
  type TokenResponse,
} from "@corbits/oauth-core";
import type { DB } from "@intx/db";
import { credential, tenant } from "@intx/db/schema";
import { getLogger } from "@intx/log";
import { credentialAad, type CredentialCipher } from "@intx/types";
import { credentialProvider, type SignIn } from "@corbits-builder/plugin";
import type { PluginCredential } from "@corbits-builder/plugin-host/catalog";
import type {
  PluginSignInDisconnected,
  PluginSignInFailure,
  PluginSignInStarted,
  PluginSignInState,
} from "@corbits-builder/schemas/settings";
import { project, signInClient } from "../db/schema.ts";
import type { Actor } from "../lib/actor.ts";
import { grantAuthorization } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  dropPluginCredential,
  heldPluginCredential,
  holdSignedInCredential,
} from "./plugin-credentials.ts";

const log = getLogger(["corbits-builder", "plugin-sign-in"]);

/** The callback path under the hub's public address that the provider sends the person back to. */
export const SIGN_IN_CALLBACK_PATH = "/api/oauth/callback";

// Long enough to sign in, set up an account or pick a team on the provider's page.
const PENDING_MS = 15 * 60 * 1000;
// How long a finished sign-in still answers its poll.
const SETTLED_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 30_000;
const REVOKE_TIMEOUT_MS = 15_000;

/**
 * The address a provider sends the person back to. It keeps the path of the hub's public address,
 * so a hub served under a path prefix registers the address it actually answers on.
 */
export function signInCallback(publicURL: URL): string {
  const base = new URL(publicURL.href);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(SIGN_IN_CALLBACK_PATH.slice(1), base).href;
}

/** A credential an installed plugin lets the person sign in for. */
export type SignInCredential = { name: string; origin: string; signIn: SignIn };

/** Of the installed plugins' credentials, those a person may sign in for. */
export const signInCredentials = (
  credentials: readonly PluginCredential[],
): SignInCredential[] =>
  credentials.flatMap((declared) =>
    "origin" in declared && declared.signIn
      ? [
          {
            name: declared.name,
            origin: declared.origin,
            signIn: declared.signIn,
          },
        ]
      : [],
  );

// The value at a dotted path of the token answer, as text. An email is never kept, because everyone
// who may see the credential can read its metadata.
function answered(response: TokenResponse, path: string | undefined) {
  if (path === undefined) return undefined;
  let at: unknown = response;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  const value =
    typeof at === "string"
      ? at
      : typeof at === "number" && Number.isFinite(at)
        ? String(at)
        : undefined;
  return value === undefined || value === "" || value.includes("@")
    ? undefined
    : value;
}

// The metadata saved with a signed-in credential's tokens. It is strings only, and never an
// address to send a token to, because anyone who may manage the credential may change it.
function signInMetadata(
  name: string,
  signIn: SignIn,
  response: TokenResponse,
): Record<string, string> {
  const account = answered(response, signIn.account?.name);
  const accountId = answered(response, signIn.account?.id);
  return {
    oauthProvider: credentialProvider(name),
    ...(account === undefined ? {} : { account }),
    ...(accountId === undefined ? {} : { accountId }),
  };
}

type Pending = {
  id: string;
  state: string;
  tenantId: string;
  principalId: string;
  // The Builder user whose session started the sign-in. Only that session's callback is exchanged.
  userId: string;
  credential: SignInCredential;
  clientId: string;
  verifier: string;
  outcome: PluginSignInState;
  expiresAt: number;
};

export function createPluginSignIns(options: {
  db: DB["db"];
  cipher: CredentialCipher;
  credentials: readonly SignInCredential[];
  /** The hub's public address, which the provider sends the person back to. */
  publicURL: URL;
  clientName: string;
  // Removes a deleted credential from the running runs that have it.
  pushRevoke: (tenantId: string, credentialId: string) => void;
  // Gives the running runs that have a credential its new tokens.
  pushRenewed: (tenantId: string, credentialId: string) => void;
  fetch?: typeof fetch;
}) {
  const { db, cipher } = options;
  const redirectUri = signInCallback(options.publicURL);
  const byName = new Map(options.credentials.map((each) => [each.name, each]));
  const base = options.fetch ?? fetch;
  // A request with a code, a token or a registration never follows a redirect, wherever it points:
  // a redirect is a failure.
  const noRedirects: typeof fetch = Object.assign(
    (input: Request | string | URL, init?: RequestInit) =>
      base(input, { ...init, redirect: "manual" }),
    { preconnect: fetch.preconnect },
  );

  const config = (
    { signIn }: SignInCredential,
    clientId: string,
  ): OAuthClientConfig => ({
    clientId,
    authorizeUrl: signIn.authorize,
    tokenUrl: signIn.token,
    redirectUri,
    scopes: signIn.scopes,
    tokenTimeoutMs: TOKEN_TIMEOUT_MS,
  });

  const storedClient = async (name: string) => {
    const [stored] = await db
      .select({ clientId: signInClient.clientId })
      .from(signInClient)
      .where(
        and(
          eq(signInClient.redirectUri, redirectUri),
          eq(signInClient.name, name),
        ),
      );
    return stored?.clientId;
  };

  // The client the hub signs people in as for this credential. It is registered at the provider the
  // first time and reused after that.
  async function clientFor(declared: SignInCredential) {
    const stored = await storedClient(declared.name);
    if (stored !== undefined) return stored;
    let clientId: string;
    try {
      ({ clientId } = await registerMcpClient({
        registrationEndpoint: declared.signIn.client.register,
        redirectUris: [redirectUri],
        clientName: options.clientName,
        scope: declared.signIn.scopes.join(" "),
        fetchImpl: noRedirects,
      }));
    } catch (error) {
      // The library's message can include the provider's answer, which must not reach the log.
      log.warn("Registering at {credential}'s provider failed: {failure}", {
        credential: declared.name,
        failure: error instanceof Error ? error.name : "unknown",
      });
      throw new ProjectError(502, "sign_in_unregistered");
    }
    // Two racing first sign-ins each register a client; every later sign-in uses the first saved.
    await db
      .insert(signInClient)
      .values({ redirectUri, name: declared.name, clientId })
      .onConflictDoNothing();
    return (await storedClient(declared.name))!;
  }

  const pending = new Map<string, Pending>();
  const byState = new Map<string, Pending>();

  function settle(entry: Pending, outcome: PluginSignInState) {
    byState.delete(entry.state);
    if (entry.outcome.status !== "pending") return;
    entry.outcome = outcome;
    entry.expiresAt = Date.now() + SETTLED_MS;
  }
  const fail = (entry: Pending, code: PluginSignInFailure) =>
    settle(entry, { status: "failed", code });

  function sweep(now = Date.now()) {
    for (const entry of pending.values()) {
      if (now < entry.expiresAt) continue;
      if (entry.outcome.status === "pending") fail(entry, "sign_in_expired");
      else pending.delete(entry.id);
    }
  }

  // Only the person who started a sign-in can follow it, and only in the tenant they started it in.
  function owned(actor: Actor, id: string) {
    sweep();
    const entry = pending.get(id);
    if (
      !entry ||
      entry.tenantId !== actor.tenantId ||
      entry.principalId !== actor.principalId
    )
      throw new ProjectError(404, "sign_in_not_found");
    return entry;
  }

  const declaredOf = (name: string) => {
    const declared = byName.get(name);
    if (!declared) throw new ProjectError(404, "sign_in_unknown");
    return declared;
  };

  // The workspace of a project tenant. The workspace has the provider rows the project's keys are
  // sent through. undefined when the tenant is not a project's.
  async function workspaceOf(tenantId: string) {
    const [found] = await db
      .select({ workspace: tenant.parentId })
      .from(project)
      .innerJoin(tenant, eq(tenant.id, project.tenantId))
      .where(and(eq(project.tenantId, tenantId), isNotNull(tenant.parentId)));
    return found?.workspace ?? undefined;
  }

  async function save(entry: Pending, response: TokenResponse) {
    const workspaceTenantId = await workspaceOf(entry.tenantId);
    if (workspaceTenantId === undefined)
      throw new Error("sign_in_project_gone");
    const { credential: declared } = entry;
    const saved = await db.transaction((tx) =>
      holdSignedInCredential(tx, cipher, {
        tenantId: entry.tenantId,
        workspaceTenantId,
        name: declared.name,
        origin: declared.origin,
        tokens: baseTokensFromResponse(response, Date.now(), undefined),
        scopes: declared.signIn.scopes,
        metadata: signInMetadata(declared.name, declared.signIn, response),
      }),
    );
    if (saved.replaced !== undefined)
      options.pushRevoke(entry.tenantId, saved.replaced);
    else options.pushRenewed(entry.tenantId, saved.id);
  }

  // Revokes one token at the provider. The token goes in the form and the access token as a bearer
  // token, because providers differ on where they read it. Returns whether the provider said it
  // was revoked; the body of its answer is never read.
  async function revokeAtProvider(
    address: string,
    token: string,
    access: string,
    hint: "access_token" | "refresh_token",
  ) {
    try {
      const response = await noRedirects(address, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    /**
     * Starts a sign-in for `name` in `actor`'s project tenant, replacing any sign-in for it that
     * the same tenant has under way.
     */
    async start(
      actor: Actor,
      userId: string,
      name: string,
    ): Promise<PluginSignInStarted> {
      const declared = declaredOf(name);
      // A token that can spend money belongs to one project and is never shared across a workspace.
      if ((await workspaceOf(actor.tenantId)) === undefined)
        throw new ProjectError(409, "sign_in_project_only");
      const clientId = await clientFor(declared);
      sweep();
      for (const earlier of pending.values())
        if (
          earlier.tenantId === actor.tenantId &&
          earlier.credential === declared
        )
          fail(earlier, "sign_in_replaced");
      const pkce = generatePkce();
      const entry: Pending = {
        id: crypto.randomUUID(),
        state: generateState(),
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        userId,
        credential: declared,
        clientId,
        verifier: pkce.verifier,
        outcome: { status: "pending" },
        expiresAt: Date.now() + PENDING_MS,
      };
      pending.set(entry.id, entry);
      byState.set(entry.state, entry);
      return {
        id: entry.id,
        url: buildAuthorizeUrl(config(declared, clientId), pkce, entry.state),
      };
    },

    state: (actor: Actor, id: string): PluginSignInState =>
      owned(actor, id).outcome,

    cancel(actor: Actor, id: string): PluginSignInState {
      const entry = owned(actor, id);
      settle(entry, { status: "cancelled" });
      return entry.outcome;
    },

    /**
     * Handles the provider sending the person back. The code is exchanged only when the returning
     * browser is signed in to Builder as the person who started the sign-in. Otherwise someone
     * could start a sign-in in their own project, send the address to another person, and get that
     * person's account. Each state is answered once. Returns whether the credential was saved.
     */
    async callback(
      query: {
        state?: string | undefined;
        code?: string | undefined;
        error?: string | undefined;
      },
      userId: string | undefined,
    ): Promise<boolean> {
      sweep();
      const entry =
        query.state === undefined ? undefined : byState.get(query.state);
      if (!entry || entry.outcome.status !== "pending") return false;
      byState.delete(entry.state);
      if (userId !== entry.userId) {
        fail(entry, "sign_in_other_session");
        return false;
      }
      if (query.error !== undefined || query.code === undefined) {
        fail(entry, "sign_in_refused");
        return false;
      }
      let response: TokenResponse;
      try {
        response = await exchangeCode(
          config(entry.credential, entry.clientId),
          query.code,
          entry.verifier,
          noRedirects,
        );
      } catch (error) {
        log.warn(
          "Exchanging a code at {credential}'s provider failed: {failure}",
          {
            credential: entry.credential.name,
            failure:
              error instanceof OAuthTokenEndpointError
                ? `status ${String(error.status)}`
                : error instanceof Error
                  ? error.name
                  : "unknown",
          },
        );
        fail(entry, "sign_in_failed");
        return false;
      }
      // The sign-in was cancelled while the provider answered.
      if (entry.outcome.status !== "pending") return false;
      try {
        await save(entry, response);
      } catch (error) {
        log.error("Saving {credential}'s sign-in failed: {failure}", {
          credential: entry.credential.name,
          failure: error instanceof Error ? error.name : "unknown",
        });
        fail(entry, "sign_in_failed");
        return false;
      }
      settle(entry, { status: "done" });
      return true;
    },

    /**
     * Revokes the signed-in credential `actor`'s tenant has under `name` at its provider, if the
     * plugin declares where, then deletes it here, as Interchange's revoke does.
     */
    async disconnect(
      actor: Actor,
      name: string,
    ): Promise<PluginSignInDisconnected> {
      const declared = declaredOf(name);
      const held = await heldPluginCredential(db, actor.tenantId, name);
      if (held?.type !== "oauth_token")
        throw new ProjectError(404, "sign_in_not_found");
      const allowed = await grantAuthorization(db, actor);
      if (!(await allowed(`credential:${held.id}`, "manage")))
        throw new ProjectError(403, "forbidden");
      let revoked = false;
      const { revoke } = declared.signIn;
      if (revoke !== undefined) {
        const [row] = await db
          .select({
            secret: credential.secret,
            refreshSecret: credential.refreshSecret,
          })
          .from(credential)
          .where(eq(credential.id, held.id));
        if (row?.secret) {
          const access = await cipher.decrypt(
            row.secret,
            credentialAad(held.id, "secret"),
          );
          // Revoking the refresh token ends the grant itself (RFC 7009); revoking only the access
          // token may leave the grant alive. It goes first, while the access token sent with it
          // still works.
          let refreshRevoked = true;
          if (row.refreshSecret !== null)
            refreshRevoked = await revokeAtProvider(
              revoke,
              await cipher.decrypt(
                row.refreshSecret,
                credentialAad(held.id, "refreshSecret"),
              ),
              access,
              "refresh_token",
            );
          revoked =
            (await revokeAtProvider(revoke, access, access, "access_token")) &&
            refreshRevoked;
        }
      }
      await db.transaction((tx) =>
        dropPluginCredential(tx, actor.tenantId, held.id),
      );
      options.pushRevoke(actor.tenantId, held.id);
      return { code: revoked ? "disconnected" : "provider_may_hold_grant" };
    },

    /**
     * What the refresher renews each signed-in credential with: the token address its manifest
     * names and the hub's own client, never an address from the credential row. Keyed by the
     * credential's `oauthProvider`.
     */
    refreshers: Object.fromEntries(
      options.credentials.map((declared) => [
        credentialProvider(declared.name),
        {
          refresh: async (refreshSecret: string, now: number) => {
            const clientId = await storedClient(declared.name);
            // A token issued to a client the hub no longer has, for example after its public
            // address changed, cannot be renewed, so the person signs in again.
            if (clientId === undefined)
              throw new OAuthMissingRefreshTokenError();
            return baseTokensFromResponse(
              await refreshTokenRequest(
                config(declared, clientId),
                refreshSecret,
                noRedirects,
              ),
              now,
              refreshSecret,
            );
          },
        } satisfies Pick<OAuthLoginProvider, "refresh">,
      ]),
    ),
  };
}

export type PluginSignIns = ReturnType<typeof createPluginSignIns>;
