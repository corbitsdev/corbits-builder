import { expect, test } from "bun:test";
import change from "@corbits-builder/coder-plugin/change";
import pickColours from "@corbits-builder/pick-colours";
import {
  catalog,
  PLUGINS,
  routePlugin,
  screenPlugin,
  specialistPlugin,
  workflowAction,
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

test("a workflow action that requires a fact Builder cannot work out, or templates a field it does not take, is refused when the hub loads", () => {
  const specialist = (requires: string[][]) =>
    specialistPlugin(
      {
        builder: {
          handle: "polisher",
          runs: "specialist",
          groups: ["build"],
          when: "The person wants the app polished.",
          unless: "They want a change of their own.",
          actions: {
            polish: {
              runs: "workflow",
              when: "The person wants the app polished.",
              unless: "They want a change of their own.",
              input: "./src/polish.ts",
              requires,
              returns: [],
            },
          },
        },
      },
      { polish: workflowAction(change, runners.changeApp) },
    );
  expect(() => specialist([["app_polished"]])).toThrow(
    "polisher polish names app_polished",
  );
  expect(() => specialist([["filed:{kind}"]])).toThrow("filed:{kind}");
  expect(specialist([["app_exists"]]).actions[0]?.name).toBe("polisher polish");
});

test("a route that names an action that is not installed is refused when the hub loads", () => {
  const route = routePlugin(
    {
      builder: {
        handle: "write-a-novel",
        runs: "route",
        groups: ["writing"],
        when: "The person wants a novel.",
        unless: "They want an app.",
        guidance: "./SKILL.md",
        steps: [{ plugin: "writer", action: "write-chapter", requires: [] }],
        outcome: "app_exists",
      },
    },
    "Write it.",
  );
  expect(() => catalog([...PLUGINS, route])).toThrow("writer write-chapter");
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
