import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has an agent publish the project's saved app to the person's own server so people can open it at the server's address, or say whether it is up there. It readies the server the first time, keeps what people entered from one publish to the next, and goes back to the version before when a new one does not start. It reports the address, or in plain words what stopped it and what the person can do.",
    when: "The person wants their app put on, updated on or checked on their own server, or the server-publish plan's step says to publish.",
    unless:
      "The project has no saved app yet, the person wants it published somewhere other than a server of their own, or they want it taken down, which is server remove.",
    says: {
      doing: "Publishing to your server",
      done: "Published to your server",
    },
    fields: {
      instruction: {
        about:
          "What to do: publish the saved app, or say whether it is up; and anything the person said about the server, such as that they opened its firewall. The agent knows nothing of the conversation.",
      },
    },
  },
});
