import { defineScreen } from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    summary:
      'Tells the person plainly that Builder will write the requirements, design the app, write the build plan and build it without stopping to ask them, with one button to hand their approvals over and one to keep being asked; opened while approvals are already handed over, it offers to ask them again. The answer is { decides: "builder" } or { decides: "person" }, and Builder has then set the project to match; if they write back instead, what they wrote is their answer.',
    when: manifest.builder.actions["hand-over"].when,
    unless: manifest.builder.actions["hand-over"].unless,
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
