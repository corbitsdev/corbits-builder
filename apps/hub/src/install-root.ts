import { and, eq } from "drizzle-orm";
import type { DB, PrincipalStore } from "@intx/db";
import {
  credential,
  grant,
  modelProvider,
  principal,
  principalRole,
  provider,
  role,
  tenant,
} from "@intx/db/schema";
import { generateId } from "@intx/hub-common";
import { getLogger } from "@intx/log";
import { credentialAad, type CredentialCipher } from "@intx/types";
import { installRoot, type ServerProviderKeys } from "./config/install-root.ts";
import { modelProvider as providerEntry } from "./config/models.ts";

const log = getLogger(["corbits-builder", "hub", "install-root"]);

async function ensureRootTenant(db: DB["db"]): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: tenant.id })
      .from(tenant)
      .where(eq(tenant.slug, installRoot.slug));
    if (existing) return existing.id;
    const tenantId = generateId("tenant");
    const roleId = generateId("role");
    await tx.insert(tenant).values({
      id: tenantId,
      name: installRoot.name,
      slug: installRoot.slug,
      domain: `${installRoot.slug}.localhost`,
      parentId: null,
    });
    await tx.insert(role).values({
      id: roleId,
      tenantId,
      name: installRoot.creatorRole,
      description: "Creates workspaces under the install root",
      isSystem: true,
    });
    await tx.insert(grant).values({
      id: generateId("grant"),
      tenantId,
      roleId,
      resource: "tenant:*",
      action: "create",
      effect: "allow",
      origin: "system",
    });
    return tenantId;
  });
}

// Writes the catalog rows a connection made in Settings writes (provider, its tenant-owned
// credential, the model provider bound to it), owned by the root so every workspace inherits them.
async function seedProviderKey(
  db: DB["db"],
  cipher: CredentialCipher,
  tenantId: string,
  key: ServerProviderKeys["keys"][number],
) {
  const entry = providerEntry(key.provider)!;
  const baseURL = key.baseURL ?? entry.baseURL;
  const credentialName = `provider:${entry.id}`;
  await db.transaction(async (tx) => {
    const [vendor] = await tx
      .select({ id: provider.id })
      .from(provider)
      .where(and(eq(provider.tenantId, tenantId), eq(provider.name, entry.id)));
    const vendorId = vendor?.id ?? generateId("provider");
    if (!vendor)
      await tx.insert(provider).values({
        id: vendorId,
        tenantId,
        name: entry.id,
        plugin: entry.plugin,
        apiBaseUrl: baseURL,
        metadata: { label: entry.label },
      });
    const [stored] = await tx
      .select({ id: credential.id, secret: credential.secret })
      .from(credential)
      .where(
        and(
          eq(credential.tenantId, tenantId),
          eq(credential.name, credentialName),
        ),
      );
    const credentialId = stored?.id ?? generateId("credential");
    const sealed = () =>
      cipher.encrypt(key.secret, credentialAad(credentialId, "secret"));
    if (!stored)
      await tx.insert(credential).values({
        id: credentialId,
        tenantId,
        providerId: vendorId,
        name: credentialName,
        type: "api_key",
        secret: await sealed(),
      });
    else if (
      (await cipher.decrypt(
        stored.secret,
        credentialAad(credentialId, "secret"),
      )) !== key.secret
    ) {
      await tx
        .update(credential)
        .set({
          secret: await sealed(),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(credential.id, credentialId));
      log.info("Server provider key {env} changed; credential updated", {
        env: key.env,
      });
    }
    const [bound] = await tx
      .select({ id: modelProvider.id, baseURL: modelProvider.baseURL })
      .from(modelProvider)
      .where(
        and(
          eq(modelProvider.tenantId, tenantId),
          eq(modelProvider.name, entry.id),
        ),
      );
    if (!bound)
      await tx.insert(modelProvider).values({
        id: generateId("modelProvider"),
        tenantId,
        name: entry.id,
        plugin: entry.plugin,
        baseURL,
        credentialId,
      });
    else if (bound.baseURL !== baseURL)
      await tx
        .update(modelProvider)
        .set({ baseURL, updatedAt: new Date() })
        .where(eq(modelProvider.id, bound.id));
  });
}

/** The install root's id, made on first boot, with the server's provider keys seeded into it. */
export async function ensureInstallRoot(
  db: DB["db"],
  cipher: CredentialCipher,
  keys: ServerProviderKeys,
): Promise<string> {
  const rootId = await ensureRootTenant(db);
  if (!keys.enabled) return rootId;
  for (const key of keys.keys) await seedProviderKey(db, cipher, rootId, key);
  for (const name of keys.unsupported)
    log.info("Server provider key {name} is not supported yet", { name });
  return rootId;
}

/** Makes a person a member of the root whose only authority is creating a workspace under it. */
export async function joinInstallRoot(
  db: DB["db"],
  principals: PrincipalStore,
  rootId: string,
  userId: string,
) {
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.tenantId, rootId),
          eq(principal.kind, "user"),
          eq(principal.refId, userId),
        ),
      );
    if (member) return;
    const [creator] = await tx
      .select({ id: role.id })
      .from(role)
      .where(
        and(eq(role.tenantId, rootId), eq(role.name, installRoot.creatorRole)),
      );
    if (!creator) throw new Error("Install root has no workspace-creator role");
    const joined = await principals.create(
      {
        id: generateId("principal"),
        tenantId: rootId,
        kind: "user",
        refId: userId,
        status: "active",
      },
      tx,
    );
    await tx
      .insert(principalRole)
      .values({ principalId: joined.id, roleId: creator.id });
  });
}
