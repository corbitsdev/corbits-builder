import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary: "Has an agent try out the project's code and report back.",
    when: "The person wants the code tried out.",
    unless: "They want the code changed.",
    fields: {
      instruction: { about: "What to try and what to report." },
    },
  },
});
