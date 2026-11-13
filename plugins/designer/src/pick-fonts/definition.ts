import {
  defineScreen,
  type ProjectValues,
  type WrongField,
} from "@corbits-builder/plugin";
import { Fonts, Input, Output, lists, type Font } from "./schema.ts";

const describe = {
  says: {
    label: () => "Pick the fonts",
    chose: (output: typeof Output.infer) =>
      `${output.primary.name} and ${output.secondary.name}`,
  },
  summary:
    "Shows the person the fonts in use and fonts to choose a primary and a secondary font from.",
  when: "The person is unhappy with the typeface or unsure which font would suit.",
  unless:
    "They already said exactly which font they want, or they want text bigger or smaller, or a whole new look.",
  fields: {
    proposed: {
      about:
        'Fonts you suggest, by name, such as { "primary": "Fraunces" }. primary is for headings and body text; secondary is only for code and figures, never headings. Give either or both. Leave out to let the person choose.',
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

const proposedFont = (fonts: Font[], name: string | undefined) =>
  name === undefined ? undefined : named(fonts, name);

function wrongProposed(
  fonts: Font[],
  slot: Slot,
  name: string | undefined,
): WrongField[] {
  if (name === undefined || named(fonts, name)) return [];
  return [
    {
      field: "proposed",
      problem: `${slot} ${quoted([name])} is not a font this screen has.`,
      choices: closest(fonts, [name]),
      otherwise: `Or leave proposed.${slot} out.`,
    },
  ];
}

const LEAVE_OUT = "Or leave list out to offer every font.";

function wrongList(fonts: Font[], list: string | string[]): WrongField[] {
  if (typeof list === "string")
    return list in lists
      ? []
      : [
          {
            field: "list",
            problem: `${quoted([list])} is not a list.`,
            choices: describe.fields.list.choices,
            otherwise: `${describe.fields.list.otherwise} ${LEAVE_OUT}`,
          },
        ];
  const unknown = list.filter((name) => !named(fonts, name));
  if (unknown.length === 0) return [];
  return [
    {
      field: "list",
      problem: `${quoted(unknown)} ${unknown.length === 1 ? "is not a font" : "are not fonts"} this screen has.`,
      choices: closest(fonts, unknown),
      otherwise: LEAVE_OUT,
    },
  ];
}

function offered(fonts: Font[], list: string | string[]) {
  if (list === "all") return fonts;
  if (typeof list === "string")
    return fonts.filter((font) => font.lists.some((name) => name === list));
  return fonts.filter((font) => list.some((name) => named([font], name)));
}

export default defineScreen({
  input: Input,
  output: Output,
  data: Fonts,
  validate: (input, fonts, project) => {
    const wrong = [
      ...SLOTS.flatMap((slot) =>
        wrongProposed(fonts, slot, input.proposed?.[slot]),
      ),
      ...wrongList(fonts, input.list),
    ];
    if (wrong.length > 0) return wrong;
    const suggested = SLOTS.flatMap((slot) => {
      const font = proposedFont(fonts, input.proposed?.[slot]);
      return font === undefined
        ? []
        : [{ font, current: inUse(fonts, project, slot) }];
    });
    if (
      suggested.length === 0 ||
      suggested.some(({ font, current }) => font !== current)
    )
      return [];
    return [
      {
        field: "proposed",
        problem: `${quoted(suggested.map(({ font }) => font.name))} ${suggested.length === 1 ? "is already the font" : "are already the fonts"} in use.`,
        otherwise:
          "Propose a different font, or leave proposed out to let the person choose.",
      },
    ];
  },
  prepare: (input, fonts, project) => ({
    fonts: offered(fonts, input.list),
    current: {
      primary: inUse(fonts, project, "primary"),
      secondary: inUse(fonts, project, "secondary"),
    },
    proposed: {
      primary: proposedFont(fonts, input.proposed?.primary),
      secondary: proposedFont(fonts, input.proposed?.secondary),
    },
  }),
  describe,
  writes: {
    [IN_USE.primary]: (output) => output.primary.name,
    [IN_USE.secondary]: (output) => output.secondary.name,
  },
});
