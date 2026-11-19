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
      removes: {
        what: "The machine rented at Hoster and the app on it.",
        entered: "What people entered in the app goes with the machine.",
      },
    },
    fields: {
      instruction: { about: "What to do." },
    },
  },
});
