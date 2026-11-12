import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DocumentKind } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    "kind?": DocumentKind,
    "title?": type("string > 0").atMostLength(512),
  }).narrow(
    (task, ctx) =>
      (task.kind === undefined) === (task.title === undefined) ||
      ctx.mustBe("given a kind and a title together, or neither"),
  ),
  describe: {
    summary:
      "Has an agent that can look things up on the web, read the project's documents, attached files and app, and file a document, do the task and report back. With a kind and title it files the result as a document under that kind; without them its report is the answer.",
    fields: {
      instruction: {
        about:
          "What to do and what to hand back. The agent knows nothing of the conversation, so put in it everything the person said that it needs.",
      },
      kind: {
        about:
          "Only when the result should be filed: a short lowercase slug naming the document, such as competitor_analysis; the same kind revises the filed one. Give title with it.",
      },
      title: {
        about:
          "Only with kind: the document's title as the person will read it.",
      },
    },
  },
});
