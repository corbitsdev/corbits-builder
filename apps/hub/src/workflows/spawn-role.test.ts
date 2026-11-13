import { expect, test } from "bun:test";
import { join } from "node:path";
import { projectLiveToInert } from "@intx/workflow/projection";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { MODEL_PROVIDERS, settingBinding } from "../config/models.ts";
import { HOST, PLUGINS_FOLDER } from "../plugins/catalog.ts";
import { resolveRoleInference } from "./role-inference.ts";
import { roleStep, spawnedWorkflowRole } from "./spawn-role.ts";

test("a specialist added as a plugin folder alone is recognised by its run, labelled and given its tools", async () => {
  const catalog = await loadCatalog(
    [
      ...(await readPluginFolder(PLUGINS_FOLDER)),
      ...(await readPluginFolder(join(import.meta.dir, "../plugins/fixtures"))),
    ],
    HOST,
  );
  const tester = catalog.role("tester");
  if (!tester) throw new Error("tester_role_missing");
  expect(tester.label).toBe("Tester");
  const brought = catalog.packages.get("tester");
  if (!brought || !("agent" in brought))
    throw new Error("tester_agent_missing");
  expect(brought.agent.role).toEqual(tester);

  process.env.BUILDER_AGENT = JSON.stringify(brought.agent);
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(
    resolveRoleInference(
      MODEL_PROVIDERS,
      tester.limits,
      settingBinding(
        MODEL_PROVIDERS,
        { profile: "anthropic_default" },
        tester.model,
      ),
    ),
  );
  const workflow = (await import("./agent-package.ts")).default;
  expect(
    roleStep({ projection: projectLiveToInert(workflow) }, catalog)?.role,
  ).toEqual(tester);
  const work = workflow.steps["work"];
  if (!work || !("agent" in work)) throw new Error("tester_step_missing");
  const tools = work.agent.toolFactories.flatMap((factory) =>
    factory.definitions.map(({ name }) => name),
  );
  expect(tools).toContain("read_artifact");
  expect(tools).not.toContain("write_artifact");
});

test("a run stored before the role tag is recognised by the role its version tag names", () => {
  const stored = (tags: Record<string, string>) => ({
    projection: { steps: { write: { agent: { tags } } } },
  });
  expect(spawnedWorkflowRole(stored({ "writer.version": "1" }))?.name).toBe(
    "writer",
  );
  expect(spawnedWorkflowRole(stored({ "unknown.version": "1" }))).toBe(
    undefined,
  );
  expect(spawnedWorkflowRole(stored({ "coordinator.version": "1" }))).toBe(
    undefined,
  );
});
