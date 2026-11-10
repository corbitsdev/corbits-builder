import { expect, test } from "bun:test";
import type { ModelCatalog, Tiers } from "@corbits-builder/schemas/models";
import { tierBindings } from "./profiles.model.ts";

const anthropic: ModelCatalog["providers"][number] = {
  id: "anthropic",
  plugin: "anthropic",
  kind: "api_key",
  label: "Anthropic",
  hint: "Anthropic",
  baseURL: "https://api.anthropic.com",
  models: [{ id: "sonnet", label: "Sonnet" }],
  connections: [],
};

function catalog(providers: ModelCatalog["providers"]): ModelCatalog {
  return {
    providers,
    roles: [
      { id: "coordinator", label: "Coordinator", hint: "", tier: "low" },
      { id: "builder", label: "App builder", hint: "", tier: "low" },
    ],
    tiers: [{ id: "low", label: "Low" }],
    efforts: [{ id: "high", label: "High" }],
    customApis: [],
    profiles: [],
  };
}

function tiers(model: string): Tiers {
  const binding = { provider: "anthropic", model, effort: "high" as const };
  return { low: binding, medium: binding, high: binding, max: binding };
}

test("names what a tier runs as the catalog names it, without the only provider", () => {
  expect(tierBindings(catalog([anthropic]), tiers("sonnet"))).toEqual([
    {
      id: "low",
      label: "Low",
      roles: ["Coordinator", "App builder"],
      model: "Sonnet",
      provider: null,
      effort: "High",
    },
  ]);
});

test("names the provider among several, and a model the catalog has dropped by its id", () => {
  const several = catalog([anthropic, { ...anthropic, id: "openai" }]);
  expect(tierBindings(several, tiers("retired"))).toMatchObject([
    { model: "retired", provider: "Anthropic" },
  ]);
});
