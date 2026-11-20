import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction.default(
      "Take the app down and give the machine rented at Hoster back.",
    ),
  }),
  describe: {
    summary:
      "Has an agent take the app down and give the machine at Hoster back.",
    when: "The person agreed to take the app down from Hoster.",
    unless: "They want something else.",
    says: {
      doing: "Taking it down from Hoster",
      done: "Taken down from Hoster",
    },
    fields: {
      instruction: { about: "What to do." },
    },
  },
});
