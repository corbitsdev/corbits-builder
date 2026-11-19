import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineWorkflow({
  // A take-down starts on what the person agreed to and nothing else, so it needs no words of the
  // coordinator's.
  input: type({
    "+": "reject",
    instruction: Instruction.default(
      "Take the project's app down from Cloudflare, keeping its database, and report that it no longer answers.",
    ),
  }),
  describe: {
    summary:
      "Has an agent take the project's app down from Cloudflare with the person's own saved key: its address stops answering, its database and what people entered are kept in their Cloudflare account, and Builder no longer counts it as published. An app in a temporary account cannot be taken down by Builder, and the run says so. Its agent can only take the app down and look, never publish. It reports that the app is down, or in plain words what stopped it and what the person can do.",
    when: "The person agreed on publish take-down to take the app down from Cloudflare, and cloudflare removable passes.",
    unless:
      "The person has not agreed on publish take-down, or the app is not published on Cloudflare.",
    says: {
      doing: "Taking it down from Cloudflare",
      done: "Taken down from Cloudflare",
      removes: {
        what: "Your app stops answering at its address.",
        entered:
          "What people entered in the app stays in your Cloudflare account, and comes back if you publish again.",
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
