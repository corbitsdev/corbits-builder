import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has an agent put the project's app on the machine rented at Hoster.",
    when: "The person wants the app on their Hoster machine.",
    unless: "They want something else.",
    fields: {
      instruction: { about: "What to do." },
    },
  },
});
