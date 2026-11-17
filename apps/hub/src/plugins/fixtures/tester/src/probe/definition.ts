import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  record: type({ "+": "reject", asked: "string > 0" }),
  describe: {
    summary: "Has an agent look into one thing about the project's code.",
    when: "The person wants one thing about the code looked into.",
    unless: "They want the code changed.",
    fields: {
      instruction: { about: "What to look into and what to report." },
    },
  },
});
