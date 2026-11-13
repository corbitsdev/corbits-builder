import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has a writer write the product requirements, or the next version of them, for whatever is being built: what it does, for whom, and how anyone will know it is done.",
    when: "Something is to be built, of any kind, and what it must do should be written down or revised with what the person said.",
    unless:
      "The person wants the thing itself built or changed, or only a mockup.",
    fields: {
      instruction: {
        about:
          "What the requirements must cover or correct. The writer sees only the filed documents and this, so put in it everything the person said that they do not record.",
      },
    },
  },
});
