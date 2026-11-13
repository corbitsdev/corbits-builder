import { defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    summary:
      'Tells the person plainly that Builder will carry out each step of the plan without stopping to ask for their approval, with one button to hand their approvals over and one to keep being asked; opened while approvals are already handed over, it offers to ask them again. The answer is { decides: "builder" } or { decides: "person" }, and Builder has then set the project to match; if they write back instead, what they wrote is their answer.',
    when: "The person says to just build it or to stop asking, or wants to be asked for their approval again.",
    unless:
      "They already answered this screen for what they asked, or they want only one document approved now.",
    fields: {
      decides: {
        about:
          "Who decides approvals now, as the Document approvals line of preferenceGuidance says.",
        choices: {
          person: "the person approves each document now (Off)",
          builder: "approvals are left to Builder now (On)",
        },
      },
    },
  },
  prefers: {
    agent_decides_approvals: (output) =>
      output.decides === "builder" ? "yes" : "no",
  },
});
