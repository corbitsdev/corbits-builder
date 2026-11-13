import { defineScreen } from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    summary:
      'Asks the person how many looks they want to compare, one, two or three, with their current setting chosen. The answer is { looks: "one" }, { looks: "two" } or { looks: "three" }, and Builder has then set the project\'s Design concepts preference to match: start that many design concepts. If they write back instead, what they wrote is their answer.',
    when: manifest.builder.actions.looks.when,
    unless: manifest.builder.actions.looks.unless,
    fields: {
      current: {
        about:
          "How many design concepts the person's setting starts now, as the Design concepts line of preferenceGuidance says.",
        choices: {
          one: "One",
          two: "Two",
          three: "Three",
          four: "Four",
          five: "Five",
        },
      },
    },
  },
  prefers: {
    design_concepts: (output) => output.looks,
  },
});
