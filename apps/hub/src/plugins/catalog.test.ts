import { expect, test } from "bun:test";
import changeApp from "@corbits-builder/change-app";
import pickColours from "@corbits-builder/pick-colours";
import {
  catalog,
  PLUGINS,
  routePlugin,
  screenPlugin,
  workflowPlugin,
} from "./catalog.ts";
import * as runners from "./runners.ts";
import { fields } from "./search/fields.ts";
import { triggers } from "./search/triggers.ts";

const handles = (ranked: { handle: string }[]) =>
  ranked.map(({ handle }) => handle);

test("a plugin whose builder block has no groups is refused when the hub loads", () => {
  expect(() =>
    screenPlugin(
      {
        builder: {
          handle: "pick-colors",
          runs: "screen",
          screen: "./src/screen.ts",
          groups: "look",
          when: "The person wants other colours.",
          unless: "They want a new look.",
        },
      },
      pickColours,
      undefined,
    ),
  ).toThrow("groups");
});

test("a plugin that reads a project value the hub does not have is refused when the hub loads", () => {
  expect(() =>
    screenPlugin(
      {
        builder: {
          handle: "pick-colors",
          runs: "screen",
          screen: "./src/screen.ts",
          groups: ["look"],
          when: "The person wants other colours.",
          unless: "They want a new look.",
          reads: ["look.font-primary", "look.colour-primary"],
        },
      },
      pickColours,
      undefined,
    ),
  ).toThrow("look.colour-primary");
});

test("a workflow that requires a fact Builder cannot work out, or templates a field it does not take, is refused when the hub loads", () => {
  const workflow = (requires: string[][]) =>
    workflowPlugin(
      {
        builder: {
          handle: "polish-app",
          runs: "workflow",
          groups: ["build"],
          when: "The person wants the app polished.",
          unless: "They want a change of their own.",
          input: "./src/input.ts",
          requires,
          returns: [],
        },
      },
      changeApp,
      runners.changeApp,
    );
  expect(() => workflow([["app_polished"]])).toThrow("app_polished");
  expect(() => workflow([["filed:{kind}"]])).toThrow("filed:{kind}");
  expect(workflow([["app_exists"]]).builder.handle).toBe("polish-app");
});

test("a route that names a plugin that is not installed is refused when the hub loads", () => {
  const route = routePlugin(
    {
      builder: {
        handle: "write-a-novel",
        runs: "route",
        groups: ["writing"],
        when: "The person wants a novel.",
        unless: "They want an app.",
        guidance: "./SKILL.md",
        steps: [{ plugin: "write-chapter", requires: [] }],
        outcome: "app_exists",
      },
    },
    "Write it.",
  );
  expect(() => catalog([...PLUGINS, route])).toThrow("write-chapter");
});

test("fields finds pick-fonts first from how a person complains about type", () => {
  expect(handles(fields("the font is ugly", PLUGINS))[0]).toBe("pick-fonts");
  expect(handles(fields("can we use a different typeface", PLUGINS))[0]).toBe(
    "pick-fonts",
  );
});

test("triggers matches font as a whole word, not inside confront", () => {
  expect(handles(triggers("change the font", PLUGINS))).toEqual(["pick-fonts"]);
  expect(triggers("I want to confront the problem", PLUGINS)).toEqual([]);
});
