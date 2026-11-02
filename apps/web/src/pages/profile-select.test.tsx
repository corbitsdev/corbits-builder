import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelCatalog, Tiers } from "@corbits-builder/schemas/models";
import { keys } from "../queries/keys.ts";
import { NewProjectProfile } from "./profile-select.tsx";

function tiers(provider: string): Tiers {
  const binding = { provider, model: "m", effort: "medium" as const };
  return { low: binding, medium: binding, high: binding, max: binding };
}

function catalog(): ModelCatalog {
  return {
    providers: [],
    roles: [],
    tiers: [],
    efforts: [],
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
});
