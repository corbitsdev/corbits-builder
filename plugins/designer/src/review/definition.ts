import { defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      label: () => "Review the mockup",
      chose: (output) =>
        output.decision === "approved" ? "Approved" : "Changes asked for",
    },
    summary:
      'Opens the design\'s clickable mockup over the whole page, where the person tries it, comments on places in it, and approves the design or asks for changes. Builder shows the newest design itself, the live draft while a designer works; do not pass it. The answer is { decision: "approved" }, and Builder has then filed the approved option as the design. Or it is { decision: "changes", comments, message } for the designer, each comment naming the place it points at.',
    when: "The design is ready for the person to look at, or needs their approval.",
    unless: "The person only asked a question about the design.",
    fields: {
      note: {
        about:
          "A short line telling the person what to look at in this version, such as what changed since their last comments. Leave out when there is nothing to point at.",
      },
    },
  },
  approves: (output) =>
    output.decision === "approved" &&
    output.option !== undefined &&
    output.version !== "draft"
      ? [{ artifactId: output.option, version: output.version }]
      : [],
});
