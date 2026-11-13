import {
  defineScreen,
  type ProjectValues,
  type WrongField,
} from "@corbits-builder/plugin";
import { Color, Input, Output } from "./schema.ts";

const FORMAT = 'a # and six hex digits, such as "#1d4ed8"';

const describe = {
  summary:
    "Shows the person the primary (brand) and background colours in use and lets them choose new ones.",
  when: "The person is unhappy with the colours or unsure which colours would suit the brand or the background.",
  unless:
    "They already said exactly which colour they want, or they want another font, bigger or smaller text, or a whole new look.",
  fields: {
    proposed: {
      about: `Colours you suggest, each ${FORMAT}: { "primary": "#1d4ed8" }. primary is the brand colour of buttons and links, background the page behind everything; give either or both. Leave out to let the person choose.`,
    },
  },
};

type Slot = "primary" | "background";
const SLOTS: readonly Slot[] = ["primary", "background"];

// The project values, as the manifest reads them, that hold each colour in use.
const IN_USE = {
  primary: "look.color-primary",
  background: "look.color-background",
} as const;

function inUse(project: ProjectValues, slot: Slot) {
  const value = project[IN_USE[slot]];
  return typeof value === "string" ? value : undefined;
}

function wrongColor(slot: Slot, value: string | undefined): WrongField[] {
  if (value === undefined || Color.allows(value)) return [];
  return [
    {
      field: "proposed",
      problem: `${slot} ${JSON.stringify(value)} is not a colour in the accepted format, ${FORMAT}.`,
      otherwise: `Write proposed.${slot} as ${FORMAT}, or leave it out.`,
    },
  ];
}

const same = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() === b?.toLowerCase();

export default defineScreen({
  input: Input,
  output: Output,
  validate: (input, _data, project) => {
    const wrong = SLOTS.flatMap((slot) =>
      wrongColor(slot, input.proposed?.[slot]),
    );
    if (wrong.length > 0) return wrong;
    const suggested = SLOTS.flatMap((slot) => {
      const color = input.proposed?.[slot];
      return color === undefined
        ? []
        : [{ color, current: inUse(project, slot) }];
    });
    if (
      suggested.length === 0 ||
      suggested.some(({ color, current }) => !same(color, current))
    )
      return [];
    return [
      {
        field: "proposed",
        problem: `${suggested.map(({ color }) => color).join(", ")} ${suggested.length === 1 ? "is already the colour" : "are already the colours"} in use.`,
        otherwise:
          "Propose a different colour, or leave proposed out to let the person choose.",
      },
    ];
  },
  prepare: (input, _data, project) => ({
    current: {
      primary: inUse(project, "primary"),
      background: inUse(project, "background"),
    },
    proposed: {
      primary: input.proposed?.primary,
      background: input.proposed?.background,
    },
  }),
  describe,
  writes: {
    [IN_USE.primary]: (output) => output.primary,
    [IN_USE.background]: (output) => output.background,
  },
});
