import { expect, test } from "bun:test";
import { MODEL_PROVIDERS } from "../config/models.ts";
import { RoleInference, resolveRoleInference } from "./role-inference.ts";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";

const roles: WorkflowRole[] = [
  "coordinator",
  "writer",
  "reviewer",
  "designer",
  "coder",
  "presenter",
];

test("every role gives both xAI connections 15 minutes and preserves other timeout defaults", () => {
  for (const provider of MODEL_PROVIDERS) {
    for (const model of provider.models) {
      for (const role of roles) {
        const inference = resolveRoleInference(MODEL_PROVIDERS, role, {
          provider: provider.id,
          model: model.id,
          effort: "high",
        });
        // Bundled workflows parse this strict schema before forwarding parameters to Interchange.
        const parsed = RoleInference.assert(
          JSON.parse(JSON.stringify(inference)),
        );
        if (provider.id === "xai" || provider.id === "xai-api") {
          expect(parsed.parameters.totalTimeoutMs).toBe(900_000);
        } else {
          expect(parsed.parameters).not.toHaveProperty("totalTimeoutMs");
        }
        expect(parsed.parameters).not.toHaveProperty("inactivityTimeoutMs");
      }
    }
  }
});
