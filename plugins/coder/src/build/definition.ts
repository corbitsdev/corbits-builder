import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";
import { STARTER_NAMES, STARTERS } from "../contract.ts";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    "starter?": type.enumerated(...STARTER_NAMES),
  }),
  describe: {
    summary:
      "Has the coder build the project's code for the first time from the filed documents and, when one is chosen, the design. The documents are the assignment.",
    when: "The project has no code yet and its requirements or build plan say what to build.",
    unless: "The project already has code; a change to it is coder change.",
    fields: {
      instruction: {
        about:
          "What to build first and anything the person said that the documents do not record. The coder knows nothing of the conversation.",
      },
      starter: {
        about:
          "Name a starter only when the project is the kind of thing that starter is for and neither the person nor the build plan names a different stack; otherwise leave it out, and the code starts from an empty project in the stack the person and the build plan name.",
        choices: Object.fromEntries(
          STARTER_NAMES.map((name) => [name, STARTERS[name].about]),
        ),
      },
    },
  },
});
