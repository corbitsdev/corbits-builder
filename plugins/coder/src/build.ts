import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has the coder build the whole app for the first time from the filed documents and, when one is chosen, the design. The documents are the assignment.",
    fields: {
      instruction: {
        about:
          "What to build first and anything the person said that the documents do not record. The coder knows nothing of the conversation.",
      },
    },
  },
});
