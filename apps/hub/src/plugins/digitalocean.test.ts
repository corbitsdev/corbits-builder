import { expect, test } from "bun:test";
import type { ProjectView } from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
} from "@corbits-builder/plugin/publish";
import { isCheckAction } from "@corbits-builder/plugin-host/catalog";
import {
  execute,
  executePause,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { CATALOG } from "./catalog.ts";

// The DigitalOcean target and its ready-made plan, as the hub loads them from the plugins folder.

test("making, publishing and removing each run an agent of their own, binding only what its tools use", () => {
  // All play the one role: the sign-in to make and remove, the hub's key to publish.
  for (const [name, credentials, optional] of [
    ["digitalocean-create", ["digitalocean"], []],
    ["digitalocean", ["digitalocean-server"], ["digitalocean-server"]],
    ["digitalocean-remove", ["digitalocean"], []],
  ] as const) {
    const built = CATALOG.packages.get(name);
    if (!built || !("agent" in built)) throw new Error(`${name} is not built`);
    expect(built.role).toBe("digitalocean");
    expect(built.agent).toMatchObject({ credentials, optional });
  }
});

// A project with the app, these facts and these credentials saved, and nothing else.
const holding = (facts: readonly string[], saved: readonly string[]) =>
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

const asked = (action: string, input: Record<string, unknown> = {}) => ({
  plugin: "digitalocean",
  action,
  input,
});
const publishing = asked("publish", {
  instruction:
    "Publish the project's saved app to the person's server at DigitalOcean.",
});

test("a publish waits for the server create makes, and create starts without its key", async () => {
  const ready = ["ready:digitalocean"];
  const signedIn = holding(ready, ["plugin.digitalocean"]);
  expect(await executePause(CATALOG, signedIn, publishing)).toEqual(
    expect.stringContaining("digitalocean create"),
  );
  expect(
    await executePause(CATALOG, signedIn, asked("create")),
  ).toBeUndefined();
  expect(
    await executePause(
      CATALOG,
      holding(ready, ["plugin.digitalocean", "plugin.digitalocean-server"]),
      publishing,
    ),
  ).toBeUndefined();
});

test("signed out, every action that starts work opens DigitalOcean's screen, never a form for the key", async () => {
  for (const call of [asked("create"), publishing, asked("remove")])
    expect(
      await executePause(
        CATALOG,
        holding(
          ["ready:digitalocean", "removable:digitalocean"],
          ["plugin.digitalocean-server"],
        ),
        call,
      ),
    ).toEqual({
      plugin: "digitalocean",
      action: "account",
      input: {},
      resume: "rerun",
    });
});

test("remove is refused until the person's go-ahead on the take-down screen holds", async () => {
  const refused = await execute(
    CATALOG,
    holding([], ["plugin.digitalocean", "plugin.digitalocean-server"]),
    asked("remove"),
  );
  expect(refused.isError).toBe(true);
  expect(refused.content).toContain("digitalocean removable");
});

// A DigitalOcean check run against these stored values and this saved app version.
async function ran(
  action: string,
  stored: Record<string, unknown>,
  version = "abc123",
) {
  const check = CATALOG.actions
    .filter(isCheckAction)
    .find((each) => each.plugin === "digitalocean" && each.action === action);
  if (!check) throw new Error(`digitalocean ${action} is not installed`);
  const view = {
    app: { version },
    values: async (name: string) => stored[name] ?? null,
  } as unknown as ProjectView;
  return check.run(view, {});
}

const ADDRESS = "203.0.113.7";
const HELD = "2026-11-18T09:00:00.000Z";
const RELEASED = "2026-11-18T10:00:00.000Z";
const release = {
  target: "digitalocean",
  url: `http://${ADDRESS}/`,
  version: "abc123",
  at: RELEASED,
};
const held = {
  target: "digitalocean",
  place: "DigitalOcean",
  since: HELD,
  costs: "$6 a month",
};

test("live passes while the saved version is the one published at DigitalOcean", async () => {
  expect(await ran("live", { [PUBLISH_RELEASE]: release })).toMatchObject({
    pass: true,
  });
  expect(
    await ran("live", { [PUBLISH_RELEASE]: release }, "def456"),
  ).toMatchObject({
    pass: false,
    summary: "The server at DigitalOcean holds an earlier version of the app",
  });
  expect(
    await ran("live", { [PUBLISH_RELEASE]: { ...release, target: "server" } }),
  ).toMatchObject({
    pass: false,
    summary: "The app is not published on DigitalOcean",
  });
});

test("removable counts the go-ahead for what is held there now, server made but nothing published included", async () => {
  expect(
    await ran("removable", {
      [PUBLISH_HOLDING]: held,
      [PUBLISH_TAKE_DOWN]: { target: "digitalocean", holding: HELD },
    }),
  ).toMatchObject({ pass: true });
  expect(
    await ran("removable", {
      [PUBLISH_HOLDING]: held,
      [PUBLISH_RELEASE]: release,
      [PUBLISH_TAKE_DOWN]: {
        target: "digitalocean",
        release: RELEASED,
        holding: HELD,
      },
    }),
  ).toMatchObject({ pass: true });
  expect(
    await ran("removable", {
      [PUBLISH_HOLDING]: { ...held, since: "2026-11-18T11:00:00.000Z" },
      [PUBLISH_TAKE_DOWN]: { target: "digitalocean", holding: HELD },
    }),
  ).toMatchObject({ pass: false });
  expect(await ran("removable", { [PUBLISH_HOLDING]: held })).toMatchObject({
    pass: false,
    summary: "The person has not asked to take the app down from DigitalOcean",
  });
});
