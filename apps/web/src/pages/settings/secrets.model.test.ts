import { expect, test } from "bun:test";
import type { PluginCredentials } from "@corbits-builder/schemas/settings";
import { secretGroups } from "./secrets.model.ts";

const exa: PluginCredentials["credentials"][number] = {
  name: "exa",
  about: "Exa API key",
  origin: "https://api.exa.ai",
  sends: { header: "x-api-key" },
  plugins: ["Exa search", "Researcher"],
};
const server: PluginCredentials["credentials"][number] = {
  name: "server",
  about: "Your server",
  sends: "ssh",
  plugins: ["Publish"],
};

// A key the person typed, active.
const key = { type: "api_key", status: "active" };
// What a typed key's row says of how it was had.
const typed = { kind: "key", account: null, signedOut: false } as const;

test("names each plugin key by the plugins that declare it and where it is sent, and leaves out other and inactive credentials", () => {
  const groups = secretGroups(
    [
      {
        tenant: "workspace",
        project: null,
        credentials: [
          { id: "c1", name: "plugin.exa", ...key, providerId: "x" },
          { id: "c2", name: "byok-openai", ...key, providerId: "o" },
          {
            id: "c4",
            name: "plugin.exa",
            ...key,
            status: "revoked",
            providerId: "x",
          },
        ],
        servers: {},
      },
      {
        tenant: "project",
        project: "Habit tracker",
        credentials: [
          { id: "c3", name: "plugin.serpapi", ...key, providerId: "s" },
          { id: "c5", name: "plugin.server", ...key, providerId: "h" },
        ],
        servers: { h: "203.0.113.5" },
      },
    ],
    [exa, server],
  );
  expect(groups).toEqual([
    {
      id: "workspace",
      project: null,
      secrets: [
        {
          id: "c1",
          label: "Exa API key",
          usedBy: { plugins: ["Exa search", "Researcher"], host: "api.exa.ai" },
          replaceable: true,
          ...typed,
        },
      ],
    },
    {
      id: "project",
      project: "Habit tracker",
      secrets: [
        {
          id: "c3",
          label: "serpapi",
          usedBy: null,
          replaceable: false,
          ...typed,
        },
        {
          id: "c5",
          label: "Your server",
          usedBy: { plugins: ["Publish"], host: "203.0.113.5" },
          replaceable: false,
          ...typed,
        },
      ],
    },
  ]);
});

const hoster: PluginCredentials["credentials"][number] = {
  name: "hoster",
  about: "Hoster account",
  origin: "https://api.hoster.example",
  sends: "bearer",
  signIn: true,
  plugins: ["Renter"],
};
const rented: PluginCredentials["credentials"][number] = {
  name: "hoster-server",
  about: "the key to the rented machine",
  sends: "ssh",
  provisioned: true,
  plugins: ["Renter"],
};

// The hoster's signed-in account, as stored while the provider takes it or once it stopped.
const signedIn = (status: string) => ({
  id: "c1",
  name: "plugin.hoster",
  type: "oauth_token",
  status,
  providerId: "w",
  metadata: { oauthProvider: "plugin.hoster", account: "Acme team" },
});

test("a signed-in key shows its account and offers no replacement", () => {
  const [project] = secretGroups(
    [
      {
        tenant: "project",
        project: "Shop",
        credentials: [signedIn("active")],
        servers: {},
      },
    ],
    [hoster],
  );
  expect(project?.secrets).toEqual([
    {
      id: "c1",
      label: "Hoster account",
      usedBy: { plugins: ["Renter"], host: "api.hoster.example" },
      replaceable: false,
      kind: "signedIn",
      account: "Acme team",
      signedOut: false,
    },
  ]);
});

test("a key a plugin made for a server it rented is listed as made, by the server it opens, and offers no replacement", () => {
  const [project] = secretGroups(
    [
      {
        tenant: "project",
        project: "Shop",
        credentials: [
          {
            id: "c2",
            name: "plugin.hoster-server",
            type: "api_key",
            status: "active",
            providerId: "h",
          },
        ],
        servers: { h: "203.0.113.7" },
      },
    ],
    [rented],
  );
  expect(project?.secrets).toEqual([
    {
      id: "c2",
      label: "the key to the rented machine",
      usedBy: { plugins: ["Renter"], host: "203.0.113.7" },
      replaceable: false,
      kind: "provisioned",
      account: null,
      signedOut: false,
    },
  ]);
});

test("a signed-in key the provider stopped taking stays listed as signed out, though a typed key that failed is left out", () => {
  const [lapsed] = secretGroups(
    [
      {
        tenant: "project",
        project: "Shop",
        credentials: [
          signedIn("error"),
          {
            id: "c3",
            name: "plugin.exa",
            type: "api_key",
            status: "error",
            providerId: "x",
          },
        ],
        servers: {},
      },
    ],
    [hoster, exa],
  );
  expect(lapsed?.secrets).toMatchObject([
    { id: "c1", kind: "signedIn", signedOut: true },
  ]);
});

test("a key pasted for a credential that may also be signed in for is replaced like any typed key", () => {
  const [project] = secretGroups(
    [
      {
        tenant: "project",
        project: "Shop",
        credentials: [
          {
            id: "c1",
            name: "plugin.hoster",
            type: "api_key",
            status: "active",
            providerId: "w",
          },
        ],
        servers: {},
      },
    ],
    [hoster],
  );
  expect(project?.secrets).toMatchObject([
    { id: "c1", kind: "key", replaceable: true, account: null },
  ]);
});
