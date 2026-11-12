import {
  defineScreen,
  refuse,
  type ProjectValues,
} from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { Fonts, Input, Output, lists, type Font } from "./schema.ts";

const describe = {
  summary:
    "Shows the person the fonts in use and fonts to choose a primary and a secondary font from.",
  when: manifest.builder.actions["pick-fonts"].when,
  unless: manifest.builder.actions["pick-fonts"].unless,
  fields: {
    proposed: {
      about:
        'Fonts you suggest, by name, such as { "primary": "Fraunces" }. primary is for headings and text, secondary for code and figures; give either or both. Leave out to let the person choose.',
    },
    list: {
      about: "Which fonts to offer. Leave out to offer every font.",
      choices: lists,
      otherwise: "Or pass up to 20 font names.",
    },
  },
};

function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function closest(fonts: Font[], names: string[]) {
  const ranked = names.flatMap((name) =>
    fonts
      .map((font) => ({
        font,
        score: distance(name.toLowerCase(), font.name.toLowerCase()),
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3),
  );
  return Object.fromEntries(
    ranked.map(({ font }) => [
      font.name,
      `${font.lists.join(", ")}, ${font.license}`,
    ]),
  );
}

const named = (fonts: Font[], name: string) =>
  fonts.find((font) => font.name.toLowerCase() === name.toLowerCase());

const quoted = (names: string[]) =>
  names.map((name) => JSON.stringify(name)).join(", ");

type Slot = "primary" | "secondary";
const SLOTS: readonly Slot[] = ["primary", "secondary"];

// The project values, as the manifest reads them, that hold each font in use.
const IN_USE = {
  primary: "look.font-primary",
  secondary: "look.font-secondary",
} as const;

// A font in use that this screen does not have is shown as unknown, not refused.
function inUse(fonts: Font[], project: ProjectValues, slot: Slot) {
  const name = project[IN_USE[slot]];
  return typeof name === "string" ? named(fonts, name) : undefined;
}

function proposedFont(fonts: Font[], slot: Slot, name: string | undefined) {
  if (name === undefined) return undefined;
  const found = named(fonts, name);
  if (found) return found;
  return refuse({
    field: "proposed",
    problem: `${slot} ${quoted([name])} is not a font this screen has.`,
    choices: closest(fonts, [name]),
    next: `Call again with the same input and proposed.${slot} set to one of these, or left out.`,
  });
}

function offered(fonts: Font[], list: string | string[]) {
  if (list === "all") return fonts;
  if (typeof list === "string") {
    if (list in lists)
      return fonts.filter((font) => font.lists.some((name) => name === list));
    return refuse({
      field: "list",
      problem: `${quoted([list])} is not a list.`,
      choices: describe.fields.list.choices,
      otherwise: describe.fields.list.otherwise,
      next: "Call again with the same input and list corrected, or leave list out to offer every font.",
    });
  }
  const unknown = list.filter((name) => !named(fonts, name));
  if (unknown.length > 0)
    return refuse({
      field: "list",
      problem: `${quoted(unknown)} ${unknown.length === 1 ? "is not a font" : "are not fonts"} this screen has.`,
      choices: closest(fonts, unknown),
      next: "Call again with the same input and list corrected, or leave list out to offer every font.",
    });
  return fonts.filter((font) => list.some((name) => named([font], name)));
}

export default defineScreen({
  input: Input,
  output: Output,
  data: Fonts,
  prepare: (input, fonts, project) => {
    const current = {
      primary: inUse(fonts, project, "primary"),
      secondary: inUse(fonts, project, "secondary"),
    };
    const proposed = {
      primary: proposedFont(fonts, "primary", input.proposed?.primary),
      secondary: proposedFont(fonts, "secondary", input.proposed?.secondary),
    };
    const suggested = SLOTS.flatMap((slot) => proposed[slot] ?? []);
    if (
      suggested.length > 0 &&
      SLOTS.every(
        (slot) =>
          proposed[slot] === undefined || proposed[slot] === current[slot],
      )
    )
      refuse({
        field: "proposed",
        problem: `${quoted(suggested.map((font) => font.name))} ${suggested.length === 1 ? "is already the font" : "are already the fonts"} in use.`,
        next: "Call again proposing a different font, or with no proposal to let the person choose.",
      });
    return { fonts: offered(fonts, input.list), current, proposed };
  },
  describe,
  writes: {
    [IN_USE.primary]: (output) => output.primary.name,
    [IN_USE.secondary]: (output) => output.secondary.name,
  },
});
