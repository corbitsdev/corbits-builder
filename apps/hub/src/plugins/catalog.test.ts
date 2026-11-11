import { expect, test } from "bun:test";
import { PLUGINS, plugin } from "./catalog.ts";
import { fields } from "./search/fields.ts";
import { triggers } from "./search/triggers.ts";

const handles = (ranked: { handle: string }[]) =>
  ranked.map(({ handle }) => handle);

test("a plugin whose builder block has no groups is refused when the hub loads", () => {
  expect(() =>
    plugin({
      builder: {
        handle: "pick-colors",
        runs: "screen",
        groups: "look",
        when: "The person wants other colours.",
        unless: "They want a new look.",
      },
    }),
  ).toThrow("groups");
});

test("a plugin that reads a project value the hub does not have is refused when the hub loads", () => {
  expect(() =>
    plugin({
      builder: {
        handle: "pick-colors",
        runs: "screen",
        groups: ["look"],
        when: "The person wants other colours.",
        unless: "They want a new look.",
        reads: ["look.font-primary", "look.colour-primary"],
      },
    }),
  ).toThrow("look.colour-primary");
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
