import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ModelCatalog,
  ModelChoice,
  Tiers,
} from "@corbits-builder/schemas/models";
import { wording } from "../config.ts";
import { keys } from "../queries/keys.ts";
import { NewProjectProfile } from "./profile-select.tsx";
import { Profiles, available, editorProviders } from "./profiles.tsx";

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

function render(value: string | undefined, models = catalog()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.modelCatalog, models);
  client.setQueryData(keys.modelChoice, null);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NewProjectProfile value={value} onValueChange={() => {}} />
    </QueryClientProvider>,
  );
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

describe("NewProjectProfile", () => {
  test("selects the first runnable profile when none is automatic", () => {
    const initial = render(undefined);
    expect(initial).toContain("Model profile, Claude");
    expect(initial).not.toContain("Grok");

    const picked = render("openai_default");
    expect(picked).toContain("Model profile, GPT");
    expect(picked).not.toContain("Model profile, Claude");
  });

  test("keeps the automatic profile when one is set", () => {
    const models = catalog();
    models.automaticProfile = "openai_default";
    expect(render(undefined, models)).toContain("Model profile, GPT");
  });

  test("renders nothing when no profile can run", () => {
    const models = catalog();
    models.profiles = models.profiles.map((profile) => ({
      ...profile,
      available: false,
    }));
    expect(render(undefined, models)).toBe("");
  });

  test("falls back to an available profile and offers reconnect when the active profile's provider is refused", () => {
    const models = catalog();
    models.providers = [
      {
        id: "anthropic",
        plugin: "anthropic",
        label: "Anthropic",
        hint: "Claude",
        baseURL: "https://api.anthropic.com",
        kind: "api_key",
        models: [],
        connections: [
          {
            id: "prv_anthropic",
            name: "Anthropic",
            credentialSet: true,
            status: "refused",
            note: "HTTP 401",
          },
        ],
      },
      {
        id: "openai",
        plugin: "openai",
        label: "OpenAI",
        hint: "GPT",
        baseURL: "https://api.openai.com/v1",
        kind: "api_key",
        models: [],
        connections: [
          {
            id: "prv_openai",
            name: "OpenAI",
            credentialSet: true,
            status: "connected",
          },
        ],
      },
    ];
    models.profiles = [
      {
        id: "anthropic_default",
        label: "Claude",
        hint: "HTTP 401",
        tiers: tiers("anthropic"),
        available: false,
      },
      {
        id: "openai_default",
        label: "GPT",
        hint: "OpenAI",
        tiers: tiers("openai"),
        available: true,
      },
    ];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(keys.modelCatalog, models);
    client.setQueryData(keys.modelChoice, { profile: "anthropic_default" });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <NewProjectProfile value="anthropic_default" onValueChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Model profile, GPT");
    expect(html).toContain("Re-add Anthropic key");
  });

  test("offers reconnect when the only configured provider is refused", () => {
    const models = catalog();
    models.providers = [
      {
        id: "anthropic",
        plugin: "anthropic",
        label: "Anthropic",
        hint: "Claude",
        baseURL: "https://api.anthropic.com",
        kind: "api_key",
        models: [],
        connections: [
          {
            id: "prv_anthropic",
            name: "Anthropic",
            credentialSet: true,
            status: "refused",
            note: "HTTP 401",
          },
        ],
      },
    ];
    models.profiles = models.profiles.map((profile) => ({
      ...profile,
      available: false,
    }));
    expect(render(undefined, models)).toContain("Re-add Anthropic key");
  });
});

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
