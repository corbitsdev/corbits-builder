import {
  defineScreen,
  refuse,
  type ProjectValues,
  type WrongField,
} from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { Color, Input, Output } from "./schema.ts";

const FORMAT = 'a # and six hex digits, such as "#1d4ed8"';

const describe = {
  summary:
    "Shows the person the primary (brand) and background colours in use and lets them choose new ones.",
  when: manifest.builder.actions["pick-colours"].when,
  unless: manifest.builder.actions["pick-colours"].unless,
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
  prepare: (input, _data, project) => {
    const wrong = SLOTS.flatMap((slot) =>
      wrongColor(slot, input.proposed?.[slot]),
    );
    if (wrong.length > 0) refuse({ wrong });
    const current = {
      primary: inUse(project, "primary"),
      background: inUse(project, "background"),
    };
    const proposed = {
      primary: input.proposed?.primary,
      background: input.proposed?.background,
    };
    const suggested = SLOTS.flatMap((slot) => proposed[slot] ?? []);
    if (
      suggested.length > 0 &&
      SLOTS.every(
        (slot) =>
          proposed[slot] === undefined || same(proposed[slot], current[slot]),
      )
    )
      refuse({
        wrong: [
          {
            field: "proposed",
            problem: `${suggested.join(", ")} ${suggested.length === 1 ? "is already the colour" : "are already the colours"} in use.`,
          },
        ],
        next: "Call again proposing a different colour, or with no proposal to let the person choose.",
      });
    return { current, proposed };
  },
  describe,
  writes: {
    [IN_USE.primary]: (output) => output.primary,
    [IN_USE.background]: (output) => output.background,
  },
});
