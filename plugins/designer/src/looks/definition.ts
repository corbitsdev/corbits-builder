import { defineScreen } from "@corbits-builder/plugin";
import { Input, LOOKS_LABEL, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      label: () => "How many looks to compare",
      chose: (output) => LOOKS_LABEL[output.looks],
    },
    summary:
      'Asks the person how many looks they want to compare, one, two or three, with their current setting chosen. The answer is { looks: "one" }, { looks: "two" } or { looks: "three" }, and Builder has then changed the person\'s setting for how many looks to compare to match: start that many design concepts. If they write back instead, what they wrote is their answer.',
    when: "A first set of mockups is about to start and the person has not said how many looks they want to compare.",
    unless:
      "They already said how many looks they want, mockups were made already, or they have handed their approvals over to Builder.",
    fields: {
      current: {
        about:
          "How many design concepts the person's setting starts now, as the Design concepts line of their standing settings says; read_artifact lists those settings.",
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
