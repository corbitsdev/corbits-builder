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
    summary:
      "Has a writer write any document the person asks for, or the next version of one already filed. It is filed under kind and versioned, and can be reviewed and approved like any other document.",
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
