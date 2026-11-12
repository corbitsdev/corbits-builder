import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import { AUDIENCE_PERSONAS } from "./personas.ts";

export default defineWorkflow({
  input: type({
    "+": "reject",
    audience: "string > 0",
    decisionNeeded: "string > 0",
    kinds: DocumentKind.array().atLeastLength(1),
    tone: "string > 0",
    length: "string > 0",
    instruction: Instruction,
  }),
  describe: {
    summary:
      "Has a presenter build a slide deck (.pptx and .pdf) for one audience and file it as the project's next approval package, from the approved documents named in kinds and, when one is chosen, the design's tokens. Ask the person first, with the question tool, who the audience is, the decision they need from it, which documents to include and the tone and length.",
    fields: {
      audience: {
        about: "Who the deck is for.",
        choices: Object.fromEntries(
          AUDIENCE_PERSONAS.map((persona) => [
            persona.id,
            `${persona.label}: cares about ${persona.cares.join(", ")}; usually reads ${persona.defaultDocuments.join(", ")}`,
          ]),
        ),
        otherwise: "Or any other audience, in the person's words.",
      },
      decisionNeeded: {
        about: "The decision the person needs from the audience.",
      },
      kinds: {
        about:
          "The approved documents the deck covers, by kind, as read_artifact lists them.",
      },
      tone: { about: "The tone the person wants, such as plain and direct." },
      length: { about: "How long the deck should be, such as 6 slides." },
      instruction: {
        about:
          "What the deck must make the case for. The presenter sees only the documents and this, so put in it anything the person said that they do not record.",
      },
    },
  },
});
