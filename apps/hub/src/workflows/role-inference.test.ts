import { expect, test } from "bun:test";
import { type } from "arktype";
import { PerCallInferenceOptions } from "@intx/types/runtime-core";
import { MODEL_PROVIDERS } from "../config/models.ts";
import { RoleInference, resolveRoleInference } from "./role-inference.ts";
import { CATALOG } from "../plugins/catalog.ts";

test("every role gives both xAI connections their longer timeouts and keeps per-call parameters Interchange accepts", () => {
  for (const provider of MODEL_PROVIDERS) {
    for (const model of provider.models) {
      for (const { limits } of CATALOG.roles) {
        const inference = resolveRoleInference(MODEL_PROVIDERS, limits, {
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
          expect(parsed.timeouts).toEqual({
            totalTimeoutMs: 900_000,
            inactivityTimeoutMs: 900_000,
          });
        } else {
          expect(parsed.timeouts).toEqual({});
        }
      }
    }
  }
});
