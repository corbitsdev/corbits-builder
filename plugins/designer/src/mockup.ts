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
      "Has a designer make a clickable, responsive HTML mockup of an interface for each concept, such as a web app, a mobile app's screens, a dashboard or a marketing page, from the instruction and whatever documents the project has filed, if any. Each is filed as a design option for the person to compare and choose from.",
    fields: {
      instruction: {
        about:
          "What to design or change. The designer knows nothing of the conversation and cannot see an existing app, so this carries what kind of interface it is, what it is for and who uses it when no document says so, and, for something that exists, its screens and what they show.",
      },
      lookIdeas: {
        about:
          "The person's own ideas for the look, in their words, or that they left the look to you.",
      },
      concepts: {
        about:
          "The looks to design, each a label and a direction naming its colours, type and radii: one for a single suggested design, several clearly different ones to explore, at most five at a time. When the person has handed approvals over to Builder, give exactly one: that one design is made and used without asking them. A concept designed before gets a fresh designer that changes its latest draft.",
      },
    },
  },
});
