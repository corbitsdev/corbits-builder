import { afterEach, beforeEach, expect, test } from "bun:test";
import { revokeCredential, saveApiKey } from "./credentials.ts";
import { interchange } from "./interchange-stub.testing.ts";

const stamp = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

let stub: ReturnType<typeof interchange>;
beforeEach(() => {
  stub = interchange();
});
afterEach(() => stub.restore());

test("an API key is saved in the project under the workspace's provider, sent as its plugin declares", async () => {
  await saveApiKey(
    { owner: "p1", workspace: "ws" },
    "exa",
    { origin: "https://api.exa.ai", sends: { header: "x-api-key" } },
    "KEY",
  );
  expect(stub.providers).toMatchObject([
    {
      tenantId: "ws",
      name: "plugin.exa",
      plugin: "http-header",
      apiBaseUrl: "https://api.exa.ai",
    },
  ]);
  expect(stub.credentials).toMatchObject([
    { tenantId: "p1", providerId: stub.providers[0]?.id, name: "plugin.exa" },
  ]);
  expect(JSON.parse(String(stub.credentials[0]?.["secret"]))).toEqual({
    header: "x-api-key",
    value: "KEY",
  });
});

test("revoking a server key removes the project's provider for that server, and revoking an API key leaves the workspace's provider", async () => {
  // As the hub saves a connected server's key: a provider pinned to the server in the project.
  stub.providers.push({
    id: "server-row",
    tenantId: "p1",
    name: "plugin.server",
    plugin: "ssh",
    apiBaseUrl: "ssh://203.0.113.5:22",
    ...stamp,
  });
  stub.credentials.push({
    id: "server-key",
    tenantId: "p1",
    providerId: "server-row",
    name: "plugin.server",
    type: "api_key",
    status: "active",
    ...stamp,
  });
  stub.providers.push({
    id: "api-row",
    tenantId: "ws",
    name: "plugin.exa",
    plugin: "http-header",
    apiBaseUrl: "https://api.exa.ai",
    ...stamp,
  });
  stub.credentials.push({
    id: "api-key",
    tenantId: "p1",
    providerId: "api-row",
    name: "plugin.exa",
    type: "api_key",
    status: "active",
    ...stamp,
  });
  await revokeCredential("p1", "server-key");
  await revokeCredential("p1", "api-key");

  expect(stub.credentials).toEqual([]);
  expect(stub.providers.map((row) => row.id)).toEqual(["api-row"]);
});
