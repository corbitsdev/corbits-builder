import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  // A take-down acts only on what the person agreed to, so it needs no instruction from the
  // coordinator.
  input: type({
    "+": "reject",
    instruction: Instruction.default(
      "Take the project's app down from the person's own server, keeping what people entered, and report that it no longer answers.",
    ),
  }),
  describe: {
    summary:
      "Has an agent take the project's app down from the person's own server: it stops answering at its address, what people entered is kept on the server, and Builder no longer counts it as published. Its agent can only take the app down and look, never publish. It reports that the app is down, or in plain words what stopped it and what the person can do.",
    when: "The person confirmed Take it down to take the app down from their own server, and server removable passes.",
    unless:
      "The person has not confirmed Take it down, or the app is not published on their own server.",
    says: {
      doing: "Taking it down from your server",
      done: "Taken down from your server",
      confirm:
        "Your app stops answering at its address. The server stays yours, and your hosting provider bills you for it until you cancel it there. What people entered in the app stays on your server, and comes back if you publish again.",
    },
    fields: {
      instruction: {
        about:
          "Leave it out: the take-down is what the person agreed to, and the agent knows what to do.",
      },
    },
  },
});
