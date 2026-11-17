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

test("names each plugin key by the plugins that declare it, and leaves out other and inactive credentials", () => {
  const groups = secretGroups(
    [
      {
        tenant: "workspace",
        project: null,
        credentials: [
          { id: "c1", name: "plugin.exa", status: "active" },
          { id: "c2", name: "byok-openai", status: "active" },
          { id: "c4", name: "plugin.exa", status: "revoked" },
        ],
      },
      {
        tenant: "project",
        project: "Habit tracker",
        credentials: [{ id: "c3", name: "plugin.serpapi", status: "active" }],
      },
    ],
    [exa],
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
        },
      ],
    },
    {
      id: "project",
      project: "Habit tracker",
      secrets: [{ id: "c3", label: "serpapi", usedBy: null }],
    },
  ]);
});
