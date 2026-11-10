import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelCatalog, Tiers } from "@corbits-builder/schemas/models";
import { keys } from "../queries/keys.ts";
import { useNewProjectProfiles } from "./new-project-profiles.model.ts";

function tiers(provider: string): Tiers {
  const binding = { provider, model: "m", effort: "medium" as const };
  return { low: binding, medium: binding, high: binding, max: binding };
}

function catalog(): ModelCatalog {
  return {
    providers: [
      {
        id: "xai",
        plugin: "xai",
        kind: "login",
        label: "xAI",
        hint: "xAI",
        baseURL: "https://x.ai",
        models: [{ id: "m", label: "Grok 4.7" }],
        connections: [],
      },
      {
        id: "anthropic",
        plugin: "anthropic",
        kind: "api_key",
        label: "Anthropic",
        hint: "Anthropic",
        baseURL: "https://api.anthropic.com",
        models: [{ id: "m", label: "Claude" }],
        connections: [
          {
            id: "c1",
            name: "Anthropic",
            status: "connected",
            credentialSet: true,
          },
        ],
      },
      {
        id: "openai",
        plugin: "openai-responses",
        kind: "api_key",
        label: "OpenAI",
        hint: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        models: [{ id: "m", label: "GPT" }],
        connections: [
          {
            id: "c2",
            name: "OpenAI",
            status: "connected",
            credentialSet: true,
          },
        ],
      },
    ],
    roles: [{ id: "coordinator", label: "Coordinator", hint: "", tier: "low" }],
    tiers: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "max", label: "Max" },
    ],
    efforts: [{ id: "medium", label: "Medium" }],
    customApis: [],
    profiles: [
      {
        id: "xai_default",
        label: "Grok",
        hint: "Not connected",
        tiers: tiers("xai"),
        available: false,
      },
      {
        id: "anthropic_default",
        label: "Claude",
        hint: "Anthropic",
        tiers: tiers("anthropic"),
        available: true,
      },
      {
        id: "openai_default",
        label: "GPT",
        hint: "OpenAI",
        tiers: tiers("openai"),
        available: true,
      },
    ],
  };
}

/** The profile a new project would start on, then every profile offered. */
function Offered() {
  const { options, preferred } = useNewProjectProfiles();
  const name = (id: string | undefined) =>
    options.find((option) => option.id === id)?.name;
  return `${name(preferred)}: ${options.map((option) => option.name).join(", ")}`;
}

function render(models = catalog()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.modelCatalog, models);
  client.setQueryData(keys.modelChoice, null);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Offered />
    </QueryClientProvider>,
  );
}

describe("useNewProjectProfiles", () => {
  test("prefers the first runnable profile when none is automatic", () => {
    expect(render()).toBe("Claude: Claude, GPT");
  });

  test("prefers the automatic profile when one is set", () => {
    const models = catalog();
    models.automaticProfile = "openai_default";
    expect(render(models)).toBe("GPT: Claude, GPT");
  });

  test("offers nothing when no profile can run", () => {
    const models = catalog();
    models.profiles = models.profiles.map((profile) => ({
      ...profile,
      available: false,
    }));
    expect(render(models)).toBe("undefined: ");
  });
});
