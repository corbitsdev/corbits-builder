import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  isWorkflowAction,
  loadCatalog,
} from "@corbits-builder/plugin-host/catalog";
import type { Filed, Project } from "@corbits-builder/plugin-host/coordinator";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { HOST, PLUGINS_FOLDER } from "./catalog.ts";

const unused = () => {
  throw new Error("not used by this start");
};

const nothingFiled: Filed = {
  versions: new Map(),
  approved: () => undefined,
  read: unused,
  design: unused,
  startHere: () => undefined,
};

test("what a plugin's start keeps for its run is checked against its action alone and read back by the run", async () => {
  const catalog = await loadCatalog(
    [
      ...(await readPluginFolder(PLUGINS_FOLDER)),
      ...(await readPluginFolder(join(import.meta.dir, "fixtures"))),
    ],
    HOST,
  );
  const probe = catalog.actions
    .filter(isWorkflowAction)
    .find(({ plugin, action }) => plugin === "tester" && action === "probe");
  if (!probe) throw new Error("probe_action_missing");

  // The host's side of a start: the action checks what it keeps, then it is stored by the run.
  const records = new Map<string, unknown>();
  const values = new Map<string, unknown>();
  const project: Project = {
    state: unused,
    check: unused,
    following: unused,
    setFollowing: unused,
    values: unused,
    start: unused,
    runs: unused,
    stop: unused,
    plan: unused,
    savePlan: unused,
    working: unused,
    deploy: unused,
    startConcepts: unused,
    startAlone: async ({ keep }) => {
      const kept = (await keep?.(nothingFiled)) ?? {};
      const checked = probe.keep(kept);
      if (!checked.ok) throw new Error(checked.problem);
      records.set("run-1", checked.record);
      for (const [name, value] of Object.entries(kept.values ?? {}))
        values.set(name, value);
      return { runId: "run-1" };
    },
  };
  const asked = "Look into why the save button does nothing on the form.";
  const started = await probe.starter.run(
    probe.builder.start,
    { instruction: asked },
    project,
    "",
  );
  expect(started.runs).toEqual([{ runId: "run-1" }]);
  expect(records.get("run-1")).toEqual({ asked });
  expect(values.get("tester.notes")).toBe(asked);

  expect(probe.keep({ record: { asked: "" } }).ok).toBe(false);
  expect(probe.keep({ values: { "stack.language": "Go" } })).toEqual({
    ok: false,
    problem: "tester probe does not write stack.language",
  });
});
