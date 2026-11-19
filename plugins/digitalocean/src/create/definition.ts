import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  // The person already chose the server and the team that pays on the Publish to DigitalOcean
  // screen, so the run needs no instruction from the coordinator.
  input: type({
    "+": "reject",
    instruction: Instruction.default(
      "Make the server the person agreed to at DigitalOcean, or say it is up already, and report its address.",
    ),
  }),
  describe: {
    summary:
      "Has an agent make the server the person agreed to on the Publish to DigitalOcean screen, in their own DigitalOcean account, and wait until Builder can sign in to it; DigitalOcean then bills them for it each month. It makes nothing while the price or the team that pays differs from what they agreed to, makes at most one server, and never makes a new one in place of one that is gone: it forgets that one, and what was held and published there, so the person chooses a server again on the Publish to DigitalOcean screen. Its agent can make the server and nothing else. It reports the server's address, or in plain words what stopped it and what the person can do.",
    when: "The publish-to-digitalocean plan's step says to make the server, after the person chose it on the Publish to DigitalOcean screen and gave their go-ahead on publish confirm; or digitalocean publish ended blocked because the server did not answer, to learn whether it is gone.",
    unless:
      "The person has not chosen a server on the Publish to DigitalOcean screen or not given their go-ahead, they want the app published to a server that is up already, which is digitalocean publish, or they want it taken down, which is digitalocean remove.",
    says: {
      doing: "Setting up your server at DigitalOcean",
      done: "Your server at DigitalOcean is up",
    },
    fields: {
      instruction: {
        about:
          "Leave it out: the server is the one the person agreed to on the Publish to DigitalOcean screen, and the agent knows what to do.",
      },
    },
  },
});
