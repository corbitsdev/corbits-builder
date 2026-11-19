import { describe, expect, test } from "bun:test";
import type { CredentialBinding, CredentialCipher } from "@intx/types";

import type { DB } from "./client";
import { buildCredentialDelivery } from "./credential-resolution";

// One root tenant holding one provider and, when saved, one tenant-owned credential for it.
function tenantWith(saved: boolean) {
  const db = {
    query: {
      tenant: { findFirst: async () => ({ parentId: null }) },
      provider: {
        findFirst: async () => ({
          id: "prov-1",
          plugin: "http",
          apiBaseUrl: "https://api.example.com",
        }),
      },
      credential: {
        findMany: async () =>
          saved ? [{ id: "cred-1", secret: "sealed", scopes: null }] : [],
      },
    },
  } as unknown as DB["db"];
  return db;
}

const cipher = {
  decrypt: async () => "the-secret",
} as unknown as CredentialCipher;

const binding = (optional: boolean): CredentialBinding => ({
  package: "@example/publisher",
  handle: "publisher-api",
  provider: "plugin.publisher-api",
  locator: "tenant",
  ...(optional ? { optional: true } : {}),
});

const deliver = (saved: boolean, optional: boolean) =>
  buildCredentialDelivery({
    db: tenantWith(saved),
    tenantId: "tenant-1",
    bindings: [binding(optional)],
    creatorPrincipalId: null,
    invokerPrincipalId: null,
    credentialCipher: cipher,
  });

describe("an optional credential binding", () => {
  test("that no credential resolves delivers nothing instead of failing the launch", async () => {
    expect(await deliver(false, true)).toEqual({
      ok: true,
      delivery: undefined,
    });
  });

  test("a required binding that no credential resolves still fails the launch", async () => {
    const result = await deliver(false, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("unresolved");
  });

  test("that a credential resolves is delivered exactly as a required one is", async () => {
    expect(await deliver(true, true)).toEqual(await deliver(true, false));
    const delivered = await deliver(true, true);
    expect(delivered.ok && delivered.delivery?.bindings).toEqual([
      {
        handle: "publisher-api",
        credentialId: "cred-1",
        consumer: "tool:@example/publisher",
      },
    ]);
  });
});

describe("initializing a run again", () => {
  const required = { ...binding(false), handle: "publisher-cdn" };
  const deliveredHandles = async (
    earlierDelivery: {
      bindings: { handle: string; consumer: string }[];
    } | null,
  ) => {
    const result = await buildCredentialDelivery({
      db: tenantWith(true),
      tenantId: "tenant-1",
      bindings: [binding(true), required],
      creatorPrincipalId: null,
      invokerPrincipalId: null,
      credentialCipher: cipher,
      earlierDelivery,
    });
    if (!result.ok) throw new Error(result.reason.message);
    return result.delivery?.bindings.map((delivered) => delivered.handle);
  };

  test("a first initialization resolves every binding", async () => {
    expect(await deliveredHandles(null)).toEqual([
      "publisher-api",
      "publisher-cdn",
    ]);
  });

  test("keeps an optional binding absent that the earlier delivery left out, so a credential saved since is not picked up", async () => {
    expect(await deliveredHandles({ bindings: [] })).toEqual(["publisher-cdn"]);
  });

  test("resolves an optional binding again that the earlier delivery bound", async () => {
    expect(
      await deliveredHandles({
        bindings: [
          { handle: "publisher-api", consumer: "tool:@example/publisher" },
        ],
      }),
    ).toEqual(["publisher-api", "publisher-cdn"]);
  });
});
