import { defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: {
      label: () => "Choose a look",
      chose: (output) => `Chose ${output.concept}`,
    },
    summary:
      "Opens the filed design concepts side by side over the whole page, where the person tries each one, picks the one they want and may comment on any of them. Builder shows every filed concept itself; do not pass them. The answer is { concept, version, comments }, and Builder has then filed the chosen concept's option as the design; each comment names the concept it is about.",
    when: "Several design concepts are filed and the person is to pick the one they want.",
    unless:
      "Only one design is filed, which review shows, or the person only asked a question about the designs.",
    fields: {
      note: {
        about:
          "A short line to help the person choose, such as what sets the concepts apart or which you recommend. Leave out when there is nothing to add.",
      },
    },
  },
  approves: (output) => [
    { artifactId: output.option, version: output.version },
  ],
});
