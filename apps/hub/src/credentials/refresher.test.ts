import { expect, test } from "bun:test";
import type { OAuthRefreshStore } from "@corbits/oauth-core/hub";
import { pushRenewed, registeredOnly } from "./refresher.ts";

const refresh = async () => ({ access: "renewed" });

test("a due row naming a provider the hub did not register is never renewed, whatever client and token address its metadata names", async () => {
  const store: OAuthRefreshStore = {
    listDue: async () => [
      { id: "signed-in", tenantId: "t", provider: "plugin.hoster" },
      { id: "rewritten", tenantId: "t", provider: "elsewhere" },
    ],
    claim: async () => true,
  };
  const due = await registeredOnly(
    store,
    {
      "plugin.hoster": {
        oauthConfig: {
          clientId: "client-1",
          authorizeUrl: "https://hoster.example/oauth/authorize",
          tokenUrl: "https://hoster.example/oauth/token",
          redirectUri: "https://builder.example/api/oauth/callback",
          scopes: [],
          tokenTimeoutMs: 1_000,
        },
        exchange: refresh,
        refresh,
      },
    },
    async () => new Map([["signed-in", "plugin.hoster"]]),
  ).listDue(new Date(), ["plugin.hoster"]);
  expect(due.map(({ id }) => id)).toEqual(["signed-in"]);
});

test("a sign-in is renewed only under its own name, whichever plugin's provider its metadata names", async () => {
  const entry = {
    oauthConfig: {
      clientId: "client-1",
      authorizeUrl: "https://hoster.example/oauth/authorize",
      tokenUrl: "https://hoster.example/oauth/token",
      redirectUri: "https://builder.example/api/oauth/callback",
      scopes: [],
      tokenTimeoutMs: 1_000,
    },
    exchange: refresh,
    refresh,
  };
  const store: OAuthRefreshStore = {
    listDue: async () => [
      { id: "own", tenantId: "t", provider: "plugin.hoster" },
      { id: "pointed", tenantId: "t", provider: "plugin.hoster" },
    ],
    claim: async () => true,
  };
  const due = await registeredOnly(
    store,
    { "plugin.hoster": entry, "plugin.keeper": entry },
    async () =>
      new Map([
        ["own", "plugin.hoster"],
        ["pointed", "plugin.keeper"],
      ]),
  ).listDue(new Date(), ["plugin.hoster", "plugin.keeper"]);
  expect(due.map(({ id }) => id)).toEqual(["own"]);
});

test("runs holding a renewed credential are given it even when the inference sources could not be pushed", async () => {
  const reconciled: string[] = [];
  await pushRenewed("credential-1", {
    sources: async () => {
      throw new Error("sidecar router down");
    },
    holders: async () => ["run-a", "run-b"],
    reconcile: async (address) => {
      reconciled.push(address);
    },
  });
  expect(reconciled).toEqual(["run-a", "run-b"]);
});
