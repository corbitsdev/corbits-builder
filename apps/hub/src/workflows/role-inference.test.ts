import { expect, test } from "bun:test";
import { type } from "arktype";
import { PerCallInferenceOptions } from "@intx/types/runtime-core";
import { MODEL_PROVIDERS } from "../config/models.ts";
import { RoleInference, resolveRoleInference } from "./role-inference.ts";
import { CATALOG } from "../plugins/catalog.ts";

test("every output budget gives both xAI connections 15 minutes and keeps per-call parameters Interchange accepts", () => {
  for (const provider of MODEL_PROVIDERS) {
    for (const model of provider.models) {
      for (const budget of CATALOG.budgets.values()) {
        const inference = resolveRoleInference(MODEL_PROVIDERS, budget, {
          provider: provider.id,
          model: model.id,
          effort: "high",
        });
        // Bundled workflows parse this strict schema before forwarding parameters to Interchange.
        const parsed = RoleInference.assert(
          JSON.parse(JSON.stringify(inference)),
        );
        // Interchange's step selector rejects any per-call key it does not declare.
        expect(PerCallInferenceOptions(parsed.parameters)).not.toBeInstanceOf(
          type.errors,
        );
        if (provider.id === "xai" || provider.id === "xai-api") {
          expect(parsed.timeouts).toEqual({ totalTimeoutMs: 900_000 });
        } else {
          expect(parsed.timeouts).toEqual({});
        }
      }
    }
  }
});

test("a budget's thinking cap runs only on a model that thinks long against its output cap", () => {
  const designer = CATALOG.role("designer");
  if (!designer) throw new Error("designer_role_missing");
  const budget = CATALOG.budgets.get(designer.limits);
  if (!budget?.thinking) throw new Error("design_thinking_cap_missing");
  const capOn = (provider: string, model: string) =>
    resolveRoleInference(MODEL_PROVIDERS, budget, {
      provider,
      model,
      effort: "high",
    }).parameters.maxTokens;
  expect(capOn("anthropic", "claude-opus-5-5")).toBe(budget.thinking);
  expect(capOn("openai", "gpt-6.1-sol")).toBe(budget.maxOutputTokens);
});
