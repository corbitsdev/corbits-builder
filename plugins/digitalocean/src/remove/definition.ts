import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  // A take-down acts only on what the person agreed to, so it needs no instruction from the
  // coordinator.
  input: type({
    "+": "reject",
    instruction: Instruction.default(
      "Delete the server Builder made at DigitalOcean for the project, with the app on it, and report that it is gone.",
    ),
  }),
  describe: {
    summary:
      "Has an agent delete the server Builder made at DigitalOcean: the app stops answering, everything on the server is destroyed with it, including what people entered in the app, DigitalOcean stops charging for it, Builder no longer counts the app as published, and the server the person chose on the Publish to DigitalOcean screen is forgotten, so publishing again asks them to choose one again. It acts only on the person's go-ahead for what is published or held there now. Its agent can only delete the server and look, never make one or publish. It reports that the server is gone, or in plain words what stopped it and what the person can do.",
    when: "The person agreed on publish take-down to take the app down from DigitalOcean, and digitalocean removable passes.",
    unless:
      "The person has not agreed on publish take-down, or nothing is published or held at DigitalOcean.",
    says: {
      doing: "Deleting your server at DigitalOcean",
      done: "Your server at DigitalOcean is deleted",
      removes: {
        what: "Builder deletes your server at DigitalOcean, and your app stops answering at its address.",
        entered:
          "Everything on the server goes with it, including what people entered in the app, and it can't be brought back.",
      },
    },
    fields: {
      instruction: {
        about:
          "Leave it out: the take-down is what the person agreed to, and the agent knows what to do.",
      },
    },
  },
});
