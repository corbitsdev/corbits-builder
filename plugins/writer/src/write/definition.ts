import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    kind: DocumentKind,
    title: type("string > 0").atMostLength(512),
    instruction: Instruction,
  }),
  describe: {
    says: { doing: "Writing the {thing}", done: "Wrote the {thing}" },
    summary:
      "Has a writer write any document the person asks for, or the next version of one already filed. It is filed under kind and versioned, and can be reviewed and approved like any other document.",
    when: "The person asks for any document that has no action of its own, such as a problem brief, constraints, a comparison of approaches, a competitor analysis, a security review or a user manual, or wants one revised.",
    unless:
      "The document is the product requirements or the build plan, which have actions of their own, or the person wants the thing itself built or changed.",
    fields: {
      kind: {
        about:
          "A short lowercase slug naming the document, such as competitor_analysis; the same kind revises the filed one.",
      },
      title: { about: "The document's title as the person will read it." },
      instruction: {
        about:
          "What the document must cover. The writer sees only the filed documents and this, so put in it everything the person said that they do not record.",
      },
    },
  },
});
