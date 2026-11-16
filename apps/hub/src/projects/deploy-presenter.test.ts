import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  experimentalApprovals,
  preferenceGuidance,
  preferenceRegistry,
} from "../config/preferences.ts";
import { COORDINATOR } from "../workflows/coordinator-role.ts";

// The presenter is a declared agent, built from the one entry every declared agent shares.
const AGENT_ENTRY = "../workflows/agent-package.ts";

test("presenter workflow entry binds Medium tier inference and approval_package write grant", async () => {
  const { MODEL_PROVIDERS, tierBinding } = await import("../config/models.ts");
  const { resolveRoleInference } =
    await import("../workflows/role-inference.ts");
  const { CATALOG, PLUGINS_FOLDER, roleModel } =
    await import("../plugins/catalog.ts");
  const presenter = CATALOG.role("presenter");
  if (!presenter) throw new Error("presenter_role_missing");
  const choice = { profile: "anthropic_default" };
  const model = roleModel(presenter);
  expect(model.tier).toBe("medium");
  const binding = tierBinding(MODEL_PROVIDERS, choice, model);
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(
    resolveRoleInference(MODEL_PROVIDERS, model.budget, binding),
  );
  const brought = CATALOG.packages.get("presenter");
  if (brought === undefined || !("agent" in brought))
    throw new Error("presenter_agent_missing");
  process.env.BUILDER_AGENT = JSON.stringify(brought.agent);
  if (brought.agent.tools === null) throw new Error("presenter_tools_missing");
  process.env.BUILDER_TOOLS = resolve(PLUGINS_FOLDER, brought.agent.tools);
  const entry = await import(`${AGENT_ENTRY}?presenter`);
  expect(entry.director).toBeDefined();
  expect(entry.default.steps.work).toMatchObject({ triggers: 1 });
  expect(entry.default.grantRequirements).toEqual([
    { resource: "sb-project:*", action: "read", source: "invoker" },
    {
      resource: "sb-artifact:approval_package",
      action: "write",
      source: "invoker",
    },
  ]);
  expect(
    entry.default.steps.work.agent.toolFactories.flatMap(
      ({ definitions }: { definitions: { name: string }[] }) =>
        definitions.map(({ name }) => name),
    ),
  ).toEqual(
    expect.arrayContaining(["write_deck", "check_deck", "file_package"]),
  );
  expect(entry.default.sidecarPlacement.capabilities).toEqual([
    { capability: "runtime:posix", effect: "require" },
  ]);
});

test("experimental_approvals preference includes coordinator guidance when enabled and omits it when disabled", () => {
  const registryIds = preferenceRegistry().preferences.map((entry) => entry.id);
  expect(registryIds).toContain("experimental_approvals");
  expect(registryIds).not.toContain("experimental_slide_decks");
  expect(experimentalApprovals(null)).toBe(false);
  expect(experimentalApprovals({ experimental_approvals: "yes" })).toBe(true);
  expect(experimentalApprovals({ experimental_approvals: "no" })).toBe(false);

  const enabledGuidance = preferenceGuidance(
    { experimental_approvals: "yes" },
    COORDINATOR,
  ).join("\n");
  expect(enabledGuidance).toContain("files the next approval_package");
  expect(enabledGuidance).toContain("approval_package");
  expect(enabledGuidance).toContain("reviewer feedback (external");

  const disabledGuidance = preferenceGuidance(
    { experimental_approvals: "no" },
    COORDINATOR,
  ).join("\n");
  expect(disabledGuidance).not.toContain("files the next approval_package");
  expect(disabledGuidance).not.toContain("approval_package");
  expect(disabledGuidance).not.toContain("reviewer feedback");
  expect(disabledGuidance).not.toContain("Approvals:");
});
