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
      "Puts filed documents in front of the person to approve, each at its current version, with a way to open each. The answer is { approved: [{ kind, artifactId, version }] }, and Builder has then recorded the approval of exactly those versions; if they write back instead, what they wrote is their answer.",
    when: manifest.builder.actions.approve.when,
    unless: manifest.builder.actions.approve.unless,
    fields: {
      kinds: {
        about:
          "The filed documents to approve, by kind. One screen covers every document ready for the person, so list them all together.",
        choices: {
          problem_brief: "the problem brief",
          constraints: "the constraints",
          approaches: "the approaches",
          product_requirements: "the product requirements",
          build_plan: "the build plan",
        },
        otherwise:
          "Or the kind of any other filed document, as read_artifact lists it.",
      },
    },
  },
  approves: (output) =>
    output.approved.map(({ artifactId, version }) => ({ artifactId, version })),
});
