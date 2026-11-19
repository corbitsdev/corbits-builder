import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  executePause,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { HOST, PLUGINS_FOLDER } from "./catalog.ts";

const catalog = await loadCatalog(
  [
    ...(await readPluginFolder(PLUGINS_FOLDER)),
    ...(await readPluginFolder(join(import.meta.dir, "fixtures"))),
  ],
  HOST,
);

// A project with the app, these credentials saved and nothing else.
const holding = (saved: readonly string[]) =>
  ({
    state: async () => ({
      facts: new Set(["app_exists", "removable:hoster"]),
      personFacts: new Set<string>(),
      asksApprovals: false,
      checks: [],
      preferences: {},
    }),
    following: async () => [],
    plan: async () => ({ steps: [] }),
    values: async (names: readonly string[]) =>
      Object.fromEntries(names.map((name) => [name, null])),
    hasCredential: async (name: string) => saved.includes(name),
  }) as unknown as Project;

const asked = (action: string) => ({
  plugin: "hoster",
  action,
  input: { instruction: `Do the hoster ${action} work the person asked for.` },
});

test("only the credentials the started agent's tools use hold an action back", async () => {
  const keyOnly = holding(["plugin.hoster-server"]);
  expect(
    await executePause(catalog, keyOnly, asked("publish")),
  ).toBeUndefined();
  expect(await executePause(catalog, keyOnly, asked("remove"))).toEqual({
    plugin: "hoster",
    action: "account",
    input: {},
    resume: "rerun",
  });
});
