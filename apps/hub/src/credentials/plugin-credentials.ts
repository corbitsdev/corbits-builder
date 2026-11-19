/**
 * The one place the hub itself writes a plugin's credential: the provider and credential rows,
 * both named `plugin.<name>`, that a person's form writes through Interchange's routes, so a run
 * binds what the hub wrote exactly as it binds what a person saved. Interchange has no route a run
 * may use to have a credential made for it; this writes its tables directly, as the install root's
 * seeded provider keys do.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { credential, grant, provider } from "@intx/db/schema";
import { generateId } from "@intx/hub-common";
import { credentialAad, type CredentialCipher } from "@intx/types";
import { credentialProvider } from "@corbits-builder/plugin";

export type Transaction = Parameters<Parameters<DB["db"]["transaction"]>[0]>[0];

/** How Interchange reaches what a credential is for: its plugin and the address it is pinned to. */
export type ProviderShape = { plugin: string; apiBaseUrl: string };

/** Interchange's plugin a server key is sent through. */
export const SSH_PLUGIN = "ssh";

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
