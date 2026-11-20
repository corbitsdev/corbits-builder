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

test("a plugin with a sign-in credential and a provisioned one loads", () => {
  expect(catalog.credentials.map(({ name }) => name)).toContain(
    "hoster-server",
  );
  const agent = (name: string) => {
    const built = catalog.packages.get(name);
    if (!built || !("agent" in built)) throw new Error(`${name} is not built`);
    return built.agent;
  };
  // Each agent binds only what its tools use, and a key the hub makes is bound optional.
  expect(agent("hoster")).toMatchObject({
    credentials: ["hoster"],
    optional: [],
  });
  expect(agent("hoster-release")).toMatchObject({
    credentials: ["hoster-server"],
    optional: ["hoster-server"],
  });
});

test("a tools module that uses a credential its plugin does not declare stops the hub", async () => {
  await expect(
    changed("hoster", [["credentials", "hoster"], undefined]),
  ).rejects.toThrow(
    "hoster's agent hoster tools module ./src/tools.ts uses the credential hoster, which hoster does not declare",
  );
});

test("a sign-in on a credential sent in a header stops the hub", async () => {
  await expect(
    changed("hoster", [
      ["credentials", "hoster", "sends"],
      { header: "x-api-key" },
    ]),
  ).rejects.toThrow("builder.credentials.hoster.signIn must be removed");
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

test("a sign-in that names where its account is with anything but dot-separated keys stops the hub", async () => {
  for (const name of ["info..team_name", "info[0]", "$.info.team_name", ""])
    await expect(
      changed("hoster", [
        ["credentials", "hoster", "signIn", "account", "name"],
        name,
      ]),
    ).rejects.toThrow("dot-separated keys of the token answer");
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

// A project with the app, these credentials saved and nothing else, the go-ahead to take down
// included unless it is left out.
const holding = (saved: readonly string[], facts = ["removable:hoster"]) =>
  ({
    state: async () => ({
      facts: new Set(["app_exists", ...facts]),
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

test("a missing provisioned credential lets the actions that make it start and refuses the others, naming those actions", async () => {
  const signedIn = holding(["plugin.hoster"]);
  expect(
    await executePause(catalog, signedIn, asked("create")),
  ).toBeUndefined();
  expect(
    await executePause(catalog, signedIn, asked("remove")),
  ).toBeUndefined();
  // Only a maker that can start now is named: remove waits on the go-ahead to take down.
  const refused = await executePause(
    catalog,
    holding(["plugin.hoster"], []),
    asked("publish"),
  );
  expect(refused).toBeTypeOf("string");
  expect(refused).toContain("hoster create");
  expect(refused).not.toContain("hoster remove");
  expect(
    await executePause(
      catalog,
      holding(["plugin.hoster", "plugin.hoster-server"]),
      asked("publish"),
    ),
  ).toBeUndefined();
});

test("a missing provisioned credential never opens a form; a missing sign-in opens its own", async () => {
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
