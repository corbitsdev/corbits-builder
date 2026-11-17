import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has an agent check the Keyholder API and report what it answered.",
    when: "The person wants the Keyholder API checked.",
    unless: "They want something else.",
    fields: {
      instruction: { about: "What to check and what to report." },
    },
  },
});
