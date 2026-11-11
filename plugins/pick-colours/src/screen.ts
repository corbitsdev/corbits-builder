import {
  defineScreen,
  refuse,
  type ProjectValues,
} from "@corbits-builder/plugin";
import manifest from "../package.json";
import { Color, Input, Output } from "./schema.ts";

const FORMAT = 'a # and six hex digits, such as "#1d4ed8"';

const describe = {
  summary:
    "Shows the person the primary (brand) and background colours in use and lets them choose new ones.",
  when: manifest.builder.when,
  unless: manifest.builder.unless,
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

function proposedColor(slot: Slot, value: string | undefined) {
  if (value === undefined || Color.allows(value)) return value;
  return refuse({
    field: "proposed",
    problem: `${slot} ${JSON.stringify(value)} is not a colour in the accepted format, ${FORMAT}.`,
    next: `Call again with the same input and proposed.${slot} written as ${FORMAT}, or left out.`,
  });
}

const same = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() === b?.toLowerCase();

export default defineScreen({
  input: Input,
  output: Output,
  prepare: (input, _data, project) => {
    const current = {
      primary: inUse(project, "primary"),
      background: inUse(project, "background"),
    };
    const proposed = {
      primary: proposedColor("primary", input.proposed?.primary),
      background: proposedColor("background", input.proposed?.background),
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
        field: "proposed",
        problem: `${suggested.join(", ")} ${suggested.length === 1 ? "is already the colour" : "are already the colours"} in use.`,
        next: "Call again proposing a different colour, or with no proposal to let the person choose.",
      });
    return { current, proposed };
  },
  describe,
});
