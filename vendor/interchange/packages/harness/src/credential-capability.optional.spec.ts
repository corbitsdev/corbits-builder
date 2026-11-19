import { describe, expect, test } from "bun:test";
import type { GrantRule } from "@intx/types/authz";
import type { CredentialDelivery } from "@intx/types/credential-delivery";

import { createCredentialProviderRegistry } from "./credential-providers";
import { buildCredentialCapabilities } from "./step-credential-capabilities";

const PACKAGE = "@example/publisher";
const CONSUMER = `tool:${PACKAGE}`;
const ORIGIN = "https://api.example.com";

// A provider that shapes an http handle without reading its material.
const providers = createCredentialProviderRegistry([
  {
    key: "http",
    shape: () => ({
      kind: "http",
      fetch: async () => new Response("ok"),
      dispose() {},
    }),
  },
]);

const delivered: CredentialDelivery = {
  bindings: [{ handle: "publisher-api", credentialId: "cred-1", consumer: CONSUMER }],
  materials: [
    { credentialId: "cred-1", providerKey: "http", origin: ORIGIN, secret: "s" },
  ],
};

const useGrant: GrantRule = {
  id: "grant-1",
  resource: "credential:cred-1",
  action: "use",
  effect: "allow",
  origin: "system",
  conditions: { tool: CONSUMER },
  expiresAt: null,
  roleId: null,
  principalId: null,
};

const capabilityFor = (
  optional: boolean,
  current: CredentialDelivery | null,
  grants: readonly GrantRule[],
) =>
  buildCredentialCapabilities(
    [
      {
        packageName: PACKAGE,
        declaredCredentials: [
          { handle: "publisher-api", ...(optional ? { optional: true } : {}) },
        ],
      },
    ],
    { materialCell: { current }, resolveGrants: () => grants, providers },
  ).get(PACKAGE);

describe("an optional declared credential", () => {
  test("once bound, it resolves only under the use grant, as a required one does", async () => {
    for (const optional of [true, false]) {
      const granted = capabilityFor(optional, delivered, [useGrant]);
      expect((await granted!.resolve("publisher-api")).kind).toBe("http");
      const ungranted = capabilityFor(optional, delivered, []);
      await expect(ungranted!.resolve("publisher-api")).rejects.toThrow(
        `consumer ${CONSUMER} is not authorized to use credential cred-1`,
      );
    }
  });
});
