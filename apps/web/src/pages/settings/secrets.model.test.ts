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
const key = { status: "active" };
// What a typed key's row says of how it was had.
const typed = { kind: "key" } as const;

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
