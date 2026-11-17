import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    says: {
      doing: "Writing the build plan",
      done: "Wrote the build plan",
    },
    summary:
      "Has a writer write the build plan, or the next version of it, for whatever is being built: the stack, the phases of work and the acceptance checks. The writer works from the filed documents and, when there is one, the chosen design.",
    when: "Something is to be built and needs a build plan, or its plan revised: the stack, the phases of work and the checks.",
    unless: "What it must do is still being settled with the person.",
    fields: {
      instruction: {
        about:
          "What the plan must cover or correct, and the stack when the person named one. The writer sees only the filed documents and this, so put in it everything the person said that they do not record.",
      },
    },
  },
});
