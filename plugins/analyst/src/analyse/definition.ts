import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    kind: DocumentKind,
    title: type("string > 0").atMostLength(512),
  }),
  describe: {
    summary:
      "Has an analyst work through the numbers of a question, from the project's documents and figures it looks up on the web, and file the analysis as a document under kind.",
    when: "The person wants a question worked through with numbers and the result filed: what a market is worth, what a customer earns or costs, how a price or funnel plays out.",
    unless: "The task has no figures to work through.",
    fields: {
      instruction: {
        about:
          "What to analyse and what the person wants to decide with it, with every figure they gave. The analyst knows nothing of the conversation, so put in it everything it needs.",
      },
      kind: {
        about:
          "A short lowercase slug naming the analysis, such as unit_economics; the same kind revises the filed one.",
      },
      title: { about: "The analysis's title as the person will read it." },
    },
  },
});
