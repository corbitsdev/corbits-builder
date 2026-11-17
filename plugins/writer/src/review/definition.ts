import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    kind: DocumentKind,
    instruction: Instruction,
  }),
  describe: {
    says: { doing: "Reviewing the {thing}", done: "Reviewed the {thing}" },
    summary:
      "Has a reviewer give a second opinion on one filed document. The review arrives later as a message; it is advice for you to weigh, and approval stays with the person.",
    when: "You want a second opinion on a filed document before you rely on it or put it to the person.",
    unless: "The person asked for something you can start directly.",
    fields: {
      kind: {
        about: "The filed document to review.",
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
      instruction: {
        about:
          "What the reviewer should check, and what the person asked for that the document must serve. The reviewer sees only the document, the problem brief when one is filed, and this.",
      },
    },
  },
});
