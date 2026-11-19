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

test("a tools module that uses a credential its plugin does not declare stops the hub", async () => {
  await expect(
    changed("hoster", [["credentials", "hoster"], undefined]),
  ).rejects.toThrow(
    "hoster's agent hoster tools module ./src/tools.ts uses the credential hoster, which hoster does not declare",
  );
});

test("a provisioned credential that the person could do without stops the hub", async () => {
  await expect(
    changed("hoster", [
      ["credentials", "hoster-server", "notNeededWhile"],
      "hoster.keep",
    ]),
  ).rejects.toThrow(
    'builder.credentials["hoster-server"].notNeededWhile must be removed',
  );
});

test("a provisioned credential with a form stops the hub", async () => {
  await expect(
    changed("hoster", [["credentials", "hoster-server", "screen"], "account"]),
  ).rejects.toThrow("plugins/hoster/package.json");
});

test("an action that provisions a credential its plugin does not declare as provisioned stops the hub", async () => {
  await expect(
    changed("hoster", [["actions", "publish", "provisions"], ["hoster"]]),
  ).rejects.toThrow(
    "hoster publish provisions hoster, which hoster does not declare as a provisioned credential",
  );
  await expect(
    changed("hoster", [["actions", "publish", "provisions"], ["server"]]),
  ).rejects.toThrow(
    "hoster publish provisions server, which hoster does not declare as a provisioned credential",
  );
});

test("a provisioned credential no action of its plugin provisions stops the hub", async () => {
  await expect(
    changed(
      "hoster",
      [["actions", "create", "provisions"], undefined],
      [["actions", "remove", "provisions"], undefined],
    ),
  ).rejects.toThrow(
    "hoster's credential hoster-server is provisioned, but no action of hoster provisions it",
  );
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
