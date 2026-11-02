import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelCatalog, Tiers } from "@corbits-builder/schemas/models";
import { keys } from "../queries/keys.ts";
import { NewProjectProfile } from "./profile-select.tsx";

const SETTINGS_DETOUR =
  "Choose a model profile in Settings, Profiles, and the coordinator can start.";

function tiers(provider: string): Tiers {
  const binding = { provider, model: "m", effort: "medium" as const };
  return { low: binding, medium: binding, high: binding, max: binding };
}

/** Two providers connected, so the catalog has no automatic profile. */
function severalProviders(): ModelCatalog {
  return {
    providers: [],
    roles: [],
    tiers: [],
    efforts: [],
    customApis: [],
    unresolved: {
      code: "model_profile_required",
      message: `More than one model provider is connected. ${SETTINGS_DETOUR}`,
    },
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

function render(value: string | undefined, catalog = severalProviders()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.modelCatalog, catalog);
  client.setQueryData(keys.modelChoice, null);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NewProjectProfile value={value} onValueChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("NewProjectProfile", () => {
  test("renders and can show each runnable profile when none is automatic", () => {
    const initial = render(undefined);
    expect(initial).toContain('data-slot="prompt-input-model-select"');
    expect(initial).toContain('role="combobox"');
    expect(initial).toContain('aria-haspopup="listbox"');
    expect(initial).toContain("Model profile, Claude");
    expect(initial).not.toContain("Grok");
    expect(initial).not.toContain(SETTINGS_DETOUR);

    const cycled = render("openai_default");
    expect(cycled).toContain("Model profile, GPT");
    expect(cycled).not.toContain("Model profile, Claude");
    expect(cycled).not.toContain(SETTINGS_DETOUR);
  });

  test("keeps the automatic profile when one is set", () => {
    const catalog = severalProviders();
    catalog.automaticProfile = "openai_default";
    delete catalog.unresolved;
    expect(render(undefined, catalog)).toContain("Model profile, GPT");
  });

  test("renders nothing when no profile can run", () => {
    const catalog = severalProviders();
    catalog.profiles = catalog.profiles.map((profile) => ({
      ...profile,
      available: false,
    }));
    expect(render(undefined, catalog)).toBe("");
  });
});
