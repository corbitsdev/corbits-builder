import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has the coder build the whole app for the first time: from the filed documents and the chosen design when there are any, or from the instruction alone when the person wants it built now.",
    fields: {
      instruction: {
        about:
          "What to build and anything the person said that the documents do not record; with no documents filed, everything the app must do. The coder knows nothing of the conversation.",
      },
    },
  },
});
