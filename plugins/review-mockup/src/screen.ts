import { defineScreen } from "@corbits-builder/plugin";
import manifest from "../package.json";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    summary:
      'Opens the design\'s clickable mockup over the whole page, where the person tries it, comments on places in it, and approves the design or asks for changes. Builder shows the newest design itself, the live draft while a designer works; do not pass it. The answer is { decision: "approved" }, with the design already approved, or { decision: "changes", comments, message } for the designer, each comment naming the place it points at.',
    when: manifest.builder.when,
    unless: manifest.builder.unless,
    fields: {
      note: {
        about:
          "A short line telling the person what to look at in this version, such as what changed since their last comments. Leave out when there is nothing to point at.",
      },
    },
  },
});
