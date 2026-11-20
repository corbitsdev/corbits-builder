import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  executePause,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { HOST, PLUGINS_FOLDER } from "./catalog.ts";

const installed = await readPluginFolder(PLUGINS_FOLDER);
const fixtures = await readPluginFolder(join(import.meta.dir, "fixtures"));
const catalog = await loadCatalog([...installed, ...fixtures], HOST);

type Fields = { [key: string]: unknown };

// The installed plugins and fixtures with fields of one fixture's builder block set, each by its
// path there, or removed where the value is undefined.
function changed(
  folder: string,
  ...changes: readonly [path: readonly string[], value: unknown][]
) {
  const found = fixtures.find((each) => each.folder === folder);
  if (!found) throw new Error(`fixtures/${folder} is missing`);
  const manifest = structuredClone(found.manifest);
  for (const [path, value] of changes) {
    const key = path.at(-1);
    if (key === undefined) throw new Error("a change needs a path");
    const parent = ["builder", ...path.slice(0, -1)].reduce(
      (at, each) => at[each] as Fields,
      manifest as Fields,
    );
    if (value === undefined) delete parent[key];
    else parent[key] = value;
  }
  return loadCatalog(
    [
      ...installed,
      ...fixtures.map((each) =>
        each === found ? { ...each, manifest } : each,
      ),
    ],
    HOST,
  );
}

test("a sign-in address with a query, a user or plain http to another machine stops the hub", async () => {
  for (const token of [
    "https://hoster.example/oauth/token?client=x",
    "https://someone@hoster.example/oauth/token",
    "http://hoster.example/oauth/token",
  ])
    await expect(
      changed("hoster", [["credentials", "hoster", "signIn", "token"], token]),
    ).rejects.toThrow("an https address with no user, query or fragment");
});

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

test("a missing provisioned credential never opens a form; a missing sign-in opens its own, and only the credentials the started agent's tools use hold an action back", async () => {
  const nothing = holding([]);
  expect(await executePause(catalog, nothing, asked("create"))).toEqual({
    plugin: "hoster",
    action: "account",
    input: {},
    resume: "rerun",
  });
  expect(await executePause(catalog, nothing, asked("publish"))).toBeTypeOf(
    "string",
  );
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
