import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  input: type({ "+": "reject", instruction: Instruction }),
  describe: {
    summary:
      "Has an agent publish the project's saved app to Cloudflare so people can open it at its own workers.dev address over HTTPS, or say whether it answers. It builds the app, readies its database and keeps what people entered from one publish to the next. Without the person's own Cloudflare account it publishes to a temporary account they then keep from the Publish tab within an hour. It reports the address, or in plain words what stopped it and what the person can do.",
    when: "The person wants their app put on, updated on or checked on Cloudflare, or the publish-to-cloudflare plan's step says to publish.",
    unless:
      "The project has no saved app yet, the app is not made to run on Cloudflare Workers (cloudflare ready says so), the person wants it published somewhere else, or they want it taken down, which is cloudflare remove.",
    says: {
      doing: "Publishing to Cloudflare",
      done: "Published to Cloudflare",
    },
    fields: {
      instruction: {
        about:
          "What to do: publish the saved app, or say whether it answers; and anything the person said about Cloudflare, such as that they kept the app or saved a key. The agent knows nothing of the conversation.",
      },
    },
  },
});
