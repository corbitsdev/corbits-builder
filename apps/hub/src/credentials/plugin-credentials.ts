/**
 * Where the hub writes a plugin's credential itself. It writes the same provider and credential
 * rows, both named `plugin.<name>`, that a person's form writes through Interchange's routes, so a
 * run binds what the hub wrote exactly as it binds what a person saved. Interchange has no route
 * for a run to have a credential made for it, and none that saves the tokens of a sign-in the hub
 * finished. So this writes Interchange's tables directly, as the install root's seeded provider
 * keys do. No other hub code writes a plugin credential.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { credential, grant, provider } from "@intx/db/schema";
import { generateId } from "@intx/hub-common";
import { credentialAad, type CredentialCipher } from "@intx/types";
import type { BaseTokens } from "@corbits/oauth-core";
import { credentialProvider } from "@corbits-builder/plugin";

export type Transaction = Parameters<Parameters<DB["db"]["transaction"]>[0]>[0];

/** How Interchange reaches what a credential is for: its plugin and the address it is pinned to. */
export type ProviderShape = { plugin: string; apiBaseUrl: string };

/** Interchange's plugin a server key is sent through. */
export const SSH_PLUGIN = "ssh";

/** Interchange's plugin a bearer token is sent through. */
export const BEARER_PLUGIN = "http";

/**
 * The credential `tenantId` itself has under a plugin credential's name, without its secret.
 * undefined when it has none, even if a tenant above it does.
 */
export async function heldPluginCredential(
  db: DB["db"] | Transaction,
  tenantId: string,
  name: string,
) {
  const [held] = await db
    .select({
      id: credential.id,
      type: credential.type,
      status: credential.status,
      metadata: credential.metadata,
      providerId: credential.providerId,
    })
    .from(credential)
    .where(
      and(
        eq(credential.tenantId, tenantId),
        eq(credential.name, credentialProvider(name)),
      ),
    );
  return held;
}

/** A credential's metadata, which is not secret, such as a server key's public half. */
export function credentialMetadata(held: { metadata: unknown }, key: string) {
  const { metadata } = held;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const kept = (metadata as Record<string, unknown>)[key];
  return typeof kept === "string" ? kept : undefined;
}

// The provider `tenantId` itself has under the credential's name, created or updated to match
// `shape`. A tenant's row shadows any above it, so a run of the project binds this one.
async function syncProvider(
  tx: Transaction,
  tenantId: string,
  name: string,
  shape: ProviderShape,
) {
  const [existing] = await tx
    .select({
      id: provider.id,
      plugin: provider.plugin,
      apiBaseUrl: provider.apiBaseUrl,
    })
    .from(provider)
    .where(
      and(
        eq(provider.tenantId, tenantId),
        eq(provider.name, credentialProvider(name)),
      ),
    );
  if (!existing) {
    const id = generateId("provider");
    await tx.insert(provider).values({
      id,
      tenantId,
      name: credentialProvider(name),
      ...shape,
    });
    return id;
  }
  if (
    existing.plugin !== shape.plugin ||
    existing.apiBaseUrl !== shape.apiBaseUrl
  )
    await tx
      .update(provider)
      .set({ ...shape, updatedAt: new Date() })
      .where(eq(provider.id, existing.id));
  return existing.id;
}

/**
 * Puts `secret` in the active tenant-owned credential `tenantId` has under `name`, under the
 * tenant's provider of that name, or saves a new one there. The caller decides first whether an
 * existing credential may be replaced. Returns the credential's id.
 */
export async function holdPluginCredential(
  tx: Transaction,
  cipher: CredentialCipher,
  held: {
    tenantId: string;
    name: string;
    shape: ProviderShape;
    secret: string;
    metadata: Record<string, string>;
  },
) {
  const providerId = await syncProvider(
    tx,
    held.tenantId,
    held.name,
    held.shape,
  );
  const existing = await heldPluginCredential(tx, held.tenantId, held.name);
  const id = existing?.id ?? generateId("credential");
  const secret = await cipher.encrypt(held.secret, credentialAad(id, "secret"));
  if (existing)
    await tx
      .update(credential)
      .set({
        providerId,
        secret,
        status: "active",
        metadata: held.metadata,
        updatedAt: new Date(),
      })
      .where(eq(credential.id, id));
  else
    await tx.insert(credential).values({
      id,
      tenantId: held.tenantId,
      providerId,
      name: credentialProvider(held.name),
      type: "api_key",
      secret,
      metadata: held.metadata,
    });
  return id;
}

/**
 * Deletes a credential of `tenantId` and its per-credential grants, as Interchange's revoke does.
 * A server key's provider row, which the tenant has for that one server, is deleted too, so the old
 * address does not shadow a key saved for the next server. The caller pushes the revoke to running
 * runs once this commits.
 */
export async function dropPluginCredential(
  tx: Transaction,
  tenantId: string,
  credentialId: string,
) {
  const [dropped] = await tx
    .delete(credential)
    .where(
      and(eq(credential.id, credentialId), eq(credential.tenantId, tenantId)),
    )
    .returning({ providerId: credential.providerId });
  if (!dropped) return;
  await tx
    .delete(grant)
    .where(
      and(
        eq(grant.tenantId, tenantId),
        eq(grant.resource, `credential:${credentialId}`),
      ),
    );
  await tx
    .delete(provider)
    .where(
      and(
        eq(provider.id, dropped.providerId),
        eq(provider.tenantId, tenantId),
        eq(provider.plugin, SSH_PLUGIN),
      ),
    );
}

/**
 * Saves a sign-in's tokens as the active tenant-owned oauth_token credential `tenantId` has under
 * `name`, under the workspace's provider of that name, as for a pasted key. An existing sign-in
 * with that name keeps its id, so runs that have it are pushed the new tokens. An existing pasted
 * key is deleted for the new credential, and its id is returned so the caller can remove it from
 * running runs once this commits. The tokens are sealed the way Interchange seals a credential's
 * secrets, so the refresher and runs read them like any other oauth_token's.
 */
export async function holdSignedInCredential(
  tx: Transaction,
  cipher: CredentialCipher,
  held: {
    tenantId: string;
    workspaceTenantId: string;
    name: string;
    origin: string;
    tokens: BaseTokens;
    scopes: readonly string[];
    metadata: Record<string, string>;
  },
): Promise<{ id: string; replaced?: string }> {
  const providerId = await syncProvider(tx, held.workspaceTenantId, held.name, {
    plugin: BEARER_PLUGIN,
    apiBaseUrl: held.origin,
  });
  const existing = await heldPluginCredential(tx, held.tenantId, held.name);
  const kept = existing?.type === "oauth_token" ? existing : undefined;
  if (existing && !kept)
    await dropPluginCredential(tx, held.tenantId, existing.id);
  const id = kept?.id ?? generateId("credential");
  const sealed = {
    providerId,
    principalId: null,
    type: "oauth_token" as const,
    secret: await cipher.encrypt(
      held.tokens.access,
      credentialAad(id, "secret"),
    ),
    refreshSecret:
      held.tokens.refresh === undefined
        ? null
        : await cipher.encrypt(
            held.tokens.refresh,
            credentialAad(id, "refreshSecret"),
          ),
    scopes: [...held.scopes],
    expiresAt:
      held.tokens.expiresAt === undefined
        ? null
        : new Date(held.tokens.expiresAt),
    status: "active" as const,
    metadata: held.metadata,
  };
  if (kept)
    await tx
      .update(credential)
      .set({ ...sealed, updatedAt: new Date() })
      .where(eq(credential.id, id));
  else
    await tx.insert(credential).values({
      id,
      tenantId: held.tenantId,
      name: credentialProvider(held.name),
      ...sealed,
    });
  return existing && !kept ? { id, replaced: existing.id } : { id };
}
