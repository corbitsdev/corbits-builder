import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import {
  DocumentKind,
  PackageAssignmentRecord,
} from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import { AUDIENCE_PERSONAS } from "../personas.ts";

export default defineWorkflow({
  // Each presenter keeps the assignment it was given, so every package it files must match it.
  record: PackageAssignmentRecord,
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
      "Has a presenter build a slide deck (.pptx and .pdf) for one audience and file it as the project's next approval package. The presenter works from the approved documents named in kinds and, when one is chosen, the design's tokens. Ask the person first, with the question tool, who the audience is, the decision they need from it, which documents to include and the tone and length. Which documents to include is a pick-several question, since a deck can cover any number of them.",
    when: "The person wants a deck and approval package for an audience, once they have said who it is for, the decision they need and which approved documents it covers.",
    unless:
      "The documents it would cover are not approved yet, or the person has not said who the audience is.",
    fields: {
      audience: {
        about: "Who the deck is for.",
        choices: Object.fromEntries(
          AUDIENCE_PERSONAS.map((persona) => [
            persona.id,
            `${persona.label}: cares about ${persona.cares.join(", ")}; usually reads ${persona.defaultDocuments.join(", ")} when the project has them`,
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
