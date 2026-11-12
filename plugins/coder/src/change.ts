import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has a fresh coder make a change the person asked for to the code the project has, built here or imported, starting from the code as last saved. It starts at once, with no documents to file or approve.",
    fields: {
      instruction: {
        about:
          "What to change, where, and anything the person said that bears on it. The coder knows nothing of the conversation, so this carries everything it needs.",
      },
    },
  },
});
