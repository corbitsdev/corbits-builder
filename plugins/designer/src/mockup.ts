import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    lookIdeas: "string > 0",
    concepts: DesignConcept.array().atLeastLength(1).atMostLength(5),
  }),
  describe: {
    summary:
      "Has a designer make a clickable, responsive mockup of the app for each concept, from whatever documents the project has filed, if any. Each is filed as a design option for the person to compare and choose from.",
    fields: {
      instruction: {
        about:
          "What to design or change. The designer knows nothing of the conversation, so this carries what the app is for and who uses it when no document says so.",
      },
      lookIdeas: {
        about:
          "The person's own ideas for the look, in their words, or that they left the look to you.",
      },
      concepts: {
        about:
          "The looks to design, each a label and a direction naming its colours, type and radii: one for a single suggested design, several clearly different ones to explore, at most five at a time. A concept designed before gets a fresh designer that changes its latest draft.",
      },
    },
  },
});
