import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has a writer write the build plan, or the next version of it: the stack, the phases of work and the acceptance checks, from the filed documents and the chosen design.",
    fields: {
      instruction: {
        about:
          "What the plan must cover or correct. The writer sees only the filed documents and this, so put in it everything the person said that they do not record.",
      },
    },
  },
});
