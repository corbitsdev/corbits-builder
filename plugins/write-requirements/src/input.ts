import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has a writer write the product requirements, or the next version of them: what the app does and for whom.",
    fields: {
      instruction: {
        about:
          "What the requirements must cover or correct. The writer sees only the filed documents and this, so put in it everything the person said that they do not record.",
      },
    },
  },
});
