import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary: "Has an agent publish the project's app to Keeper.",
    when: "The person wants the app published to Keeper.",
    unless: "They want something else.",
    fields: {
      instruction: { about: "What to publish." },
    },
  },
});
