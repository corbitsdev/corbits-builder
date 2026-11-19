import { afterAll, beforeAll, expect, test } from "bun:test";
import { installPluginRoles } from "./plugin-roles.testing.ts";
import { installRoles } from "./roles.ts";
import {
  installScreens,
  planEndsIn,
  readyPlansIn,
  specialistsIn,
} from "./screens.ts";

const plan = (
  handle: string,
  groups: string[],
  extra: Record<string, unknown> = {},
) => ({
  handle,
  runs: "plan",
  groups,
  when: `When ${handle} fits.`,
  unless: "Otherwise.",
  guidance: "./SKILL.md",
  steps: [{ plugin: "server", action: "publish", requires: [] }],
  ...extra,
});

// What the server's take-down tells the person it removes, in its own definition.
const REMOVES = {
  what: "Your app stops answering on your server.",
  entered: "What people entered is kept on your server.",
};

const manifests = {
  "@plugins/server/package.json": {
    name: "@corbits-builder/server",
    builder: {
      handle: "server",
      runs: "specialist",
      groups: ["publish"],
      when: "Publishing to a server.",
      unless: "Otherwise.",
      roles: [],
      agents: { "server-remove": { prompt: "./remove.md" } },
      actions: {
        remove: { returns: [], start: { agent: "server-remove" } },
      },
    },
  },
  "@plugins/writer/package.json": {
    name: "@corbits-builder/writer",
    builder: {
      handle: "writer",
      runs: "specialist",
      groups: ["documents"],
      when: "Writing.",
      unless: "Otherwise.",
      roles: [],
      actions: {},
    },
  },
  "@plugins/server-publish/package.json": {
    name: "@corbits-builder/server-publish",
    description: "Publishes the app to a server you rent.",
    builder: plan("publish-to-server", ["publish", "plan"], {
      ends: "published:server",
      steps: [
        { plugin: "publish", action: "confirm", requires: [] },
        { plugin: "server", action: "publish", requires: [] },
        { plugin: "server", action: "live", requires: [] },
      ],
      takeDown: { plugin: "server", action: "remove" },
      firstPublish: "It goes on your own server.",
    }),
  },
  "@plugins/host-publish/package.json": {
    name: "@corbits-builder/host-publish",
    builder: plan("publish-to-host", ["publish", "plan"]),
  },
  "@plugins/build-web-app/package.json": {
    name: "@corbits-builder/build-web-app",
    description: "Builds a web app in full.",
    builder: plan("build-web-app", ["build", "plan"], { default: true }),
  },
  "@plugins/build-web-app-express/package.json": {
    name: "@corbits-builder/build-web-app-express",
    description: "Builds a web app quickly.",
    builder: plan("build-web-app", ["build", "plan"]),
  },
};

beforeAll(() => {
  const definitions = {
    "@plugins/server/src/remove/definition.ts": {
      input: () => ({}),
      describe: {
        summary: "Takes the app down.",
        when: "The person agreed.",
        unless: "Otherwise.",
        fields: {},
        says: { doing: "Taking it down", done: "Taken down", removes: REMOVES },
      },
    },
  };
  installRoles({ manifests, definitions });
  installScreens({ manifests, definitions, data: {}, views: {} });
});

// The other test files in this process read the plugins' own roles, and find no screens installed.
afterAll(async () => {
  await installPluginRoles();
  installScreens({ manifests: {}, definitions: {}, data: {}, views: {} });
});

// The offer of an installed plan in the publish group, by its handle.
const offered = (handle: string) =>
  readyPlansIn("publish").find((offer) => offer.handle === handle);

test("a screen is offered the installed plans of the group it names", () => {
  expect(readyPlansIn("publish").map(({ handle }) => handle)).toEqual([
    "publish-to-server",
    "publish-to-host",
  ]);
  expect(readyPlansIn("research")).toEqual([]);
});

test("a plan is offered in its manifest's words: its when, and its description or else its when", () => {
  expect(offered("publish-to-server")?.about).toBe(
    "Publishes the app to a server you rent.",
  );
  expect(offered("publish-to-host")?.about).toBe("When publish-to-host fits.");
  expect(offered("publish-to-server")?.when).toBe(
    "When publish-to-server fits.",
  );
});

test("a plan offers what a first publish by it says, when it says", () => {
  expect(offered("publish-to-server")?.firstPublish).toBe(
    "It goes on your own server.",
  );
  expect(offered("publish-to-host")?.firstPublish).toBeUndefined();
});

test("a plan names each plugin its steps run, once", () => {
  expect(offered("publish-to-server")?.plugins).toEqual(["publish", "server"]);
  expect(offered("publish-to-host")?.plugins).toEqual(["server"]);
});

test("a plan's take-down is offered in its action's own words", () => {
  expect(offered("publish-to-server")?.takeDown).toEqual({
    plugin: "server",
    action: "remove",
    removes: REMOVES,
  });
  expect(offered("publish-to-host")?.takeDown).toBeUndefined();
});

test("of plans sharing a handle, the default one is offered", () => {
  expect(readyPlansIn("build")).toEqual([
    {
      handle: "build-web-app",
      about: "Builds a web app in full.",
      firstPublish: undefined,
      when: "When build-web-app fits.",
      plugins: ["server"],
      takeDown: undefined,
    },
  ]);
});

test("a group's ending facts and specialists are read from the manifests", () => {
  expect(planEndsIn("publish")).toEqual(["published:server"]);
  expect(specialistsIn("publish")).toEqual(["server"]);
});
