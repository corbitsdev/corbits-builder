import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ModelCatalog,
  ModelChoice,
  Tiers,
} from "@corbits-builder/schemas/models";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import { Profiles } from "./profiles.tsx";
import { available, editorProviders } from "./profiles.model.ts";

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

function renderProfiles(choice: ModelChoice | null, models = catalog()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.modelCatalog, models);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Profiles initialField={{ value: choice, version: 1 }} />
    </QueryClientProvider>,
  );
}

describe("Profiles", () => {
  test("offers Use only on profiles whose providers are connected", () => {
    const html = renderProfiles({ profile: "anthropic_default" });
    expect(html).toContain(wording.profiles.unavailable);
    expect(html).toContain(wording.profiles.active);
    // Only GPT is runnable and not active; Grok is unavailable so it has no Use button.
    expect(html.split(`>${wording.profiles.use}<`).length - 1).toBe(1);
  });

  test("falls back when the saved profile's provider is no longer connected", () => {
    const models = catalog();
    models.automaticProfile = "anthropic_default";
    models.unresolved = {
      code: "model_profile_required",
      message: "Choose a connected profile.",
    };
    const html = renderProfiles({ profile: "xai_default" }, models);
    expect(html).toContain(wording.profiles.active);
    expect(html).toContain(wording.profiles.detail("Claude"));
    expect(html).not.toContain(wording.profiles.detail("Grok"));
  });

  test("shows the unresolved banner when the saved profile's provider is disconnected and none is automatic", () => {
    const models = catalog();
    models.unresolved = {
      code: "model_profile_required",
      message: "Choose a connected profile.",
    };
    const html = renderProfiles({ profile: "xai_default" }, models);
    expect(html).not.toContain(wording.profiles.active);
    expect(html).toContain("Choose a connected profile.");
  });

  test("lists only connected providers when building a custom profile", () => {
    const models = catalog();
    expect(editorProviders(models).map((entry) => entry.id)).toEqual([
      "anthropic",
      "openai",
    ]);
    expect(editorProviders(models, "xai").map((entry) => entry.id)).toEqual([
      "xai",
      "anthropic",
      "openai",
    ]);
    expect(available(models, tiers("anthropic"))).toBe(true);
    expect(available(models, tiers("xai"))).toBe(false);
  });
});
