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
