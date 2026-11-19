import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary: "Has an agent rent a machine at Hoster and make its key.",
    when: "The project has no machine at Hoster yet.",
    unless: "They want something else.",
    fields: {
      instruction: { about: "What to do." },
    },
  },
});
