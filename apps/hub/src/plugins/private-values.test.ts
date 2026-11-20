import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  discoverFor,
  execute,
  executePause,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { HOST, PLUGINS_FOLDER } from "./catalog.ts";

const KEEP = "https://keeper.example/keep/s3cret-token";

const catalog = await loadCatalog(
  [
    ...(await readPluginFolder(PLUGINS_FOLDER)),
    ...(await readPluginFolder(join(import.meta.dir, "fixtures"))),
  ],
  HOST,
);

// A project holding these values, with no credential saved, and the assignment each start wrote.
function project(stored: Record<string, unknown>) {
  const assignments: string[] = [];
  const project = {
    state: async () => ({
      facts: new Set<string>(),
      personFacts: new Set<string>(),
      asksApprovals: false,
      checks: [],
      preferences: {},
    }),
    following: async () => [],
    plan: async () => ({ steps: [] }),
    values: async (names: readonly string[]) =>
      Object.fromEntries(names.map((name) => [name, stored[name] ?? null])),
    hasCredential: async () => false,
    start: async (_action: unknown, _input: unknown, values: string) => {
      assignments.push(values);
      return { runs: [{ runId: "run-1" }], notStarted: [] };
    },
  } as unknown as Project;
  return { project, assignments };
}

const publish = {
  plugin: "keeper",
  action: "publish",
  input: {
    instruction: "Publish the project's saved app to Keeper for the person.",
  },
};

test("a private value's content never reaches discover or the assignment of a run that reads it", async () => {
  const kept = project({
    "keeper.keep": { link: KEEP },
    "keeper.address": { link: "https://app.keeper.example" },
  });

  const listed = await discoverFor(catalog, kept.project, {
    query: "publish the app to Keeper",
  });
  expect(listed).toContain("keeper.keep:");
  expect(listed).toContain("https://app.keeper.example");
  expect(listed).not.toContain(KEEP);

  const started = await execute(catalog, kept.project, publish);
  expect(started.isError).toBeUndefined();
  const [assignment = ""] = kept.assignments;
  expect(assignment).toContain("- keeper.keep:");
  expect(assignment).toContain("https://app.keeper.example");
  expect(assignment).not.toContain(KEEP);
  // The run saves the address with report_values, and is never asked to hold the keep link.
  expect(assignment).toContain(
    "- keeper.address (a link, as { link: an http or https address })",
  );
  expect(assignment).not.toContain("- keeper.keep (link)");
  expect(assignment).toContain("Your own tools save keeper.keep");
});

test("a credential the plugin can do without holds an action back only while the value that stands in for it is unset", async () => {
  const unkept = project({});
  expect(await executePause(catalog, unkept.project, publish)).toEqual({
    plugin: "keeper",
    action: "key-form",
    input: {},
    resume: "rerun",
  });

  const kept = project({ "keeper.keep": { link: KEEP } });
  expect(await executePause(catalog, kept.project, publish)).toBeUndefined();
});

test("a credential that stands aside for a value no plugin declares stops the hub", async () => {
  const fixtures = await readPluginFolder(join(import.meta.dir, "fixtures"));
  const keeper = fixtures.find(({ folder }) => folder === "keeper");
  if (!keeper) throw new Error("the keeper fixture is missing");
  const manifest = structuredClone(keeper.manifest) as {
    builder: { credentials: Record<string, { notNeededWhile?: string }> };
  };
  const credential = manifest.builder.credentials["keeper-api"];
  if (!credential) throw new Error("the keeper fixture declares no key");
  credential.notNeededWhile = "keeper.unkept";
  await expect(
    loadCatalog(
      [...(await readPluginFolder(PLUGINS_FOLDER)), { ...keeper, manifest }],
      HOST,
    ),
  ).rejects.toThrow(
    "@corbits-builder/keeper's credential keeper-api is not needed while keeper.unkept is set, but no plugin declares keeper.unkept as a project value",
  );
});
