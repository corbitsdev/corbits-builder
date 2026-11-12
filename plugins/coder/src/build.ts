import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";
import { STARTER_NAMES, STARTERS } from "./contract.ts";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    starter: type.enumerated(...STARTER_NAMES),
  }),
  describe: {
    summary:
      "Has the coder build the project's code for the first time from the filed documents and, when one is chosen, the design. The documents are the assignment.",
    fields: {
      instruction: {
        about:
          "What to build first and anything the person said that the documents do not record. The coder knows nothing of the conversation.",
      },
      starter: {
        about:
          "What the code starts from. Choose by what the person asked for: a web app only when they want something used in a browser.",
        choices: Object.fromEntries(
          STARTER_NAMES.map((name) => [name, STARTERS[name].about]),
        ),
      },
    },
  },
});
