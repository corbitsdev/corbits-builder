import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has an agent publish the project's saved app to the server Builder made at DigitalOcean so people can open it at the server's address, or say whether it is up there. It readies the server the first time, keeps what people entered from one publish to the next, and goes back to the version before when a new one does not start. Its agent can neither make nor delete the server. It reports the address, or in plain words what stopped it and what the person can do.",
    when: "The person wants their app put on, updated on or checked on their server at DigitalOcean, or the publish-to-digitalocean plan's step says to publish, once digitalocean create reported the server up.",
    unless:
      "The project has no saved app yet, no server is up at DigitalOcean (digitalocean create makes it), the person wants it published somewhere else, or they want it taken down, which is digitalocean remove.",
    says: {
      doing: "Publishing to your server at DigitalOcean",
      done: "Published to your server at DigitalOcean",
    },
    fields: {
      instruction: {
        about:
          "What to do: publish the saved app, or say whether it is up; and anything the person said that bears on it. The agent knows nothing of the conversation.",
      },
    },
  },
});
