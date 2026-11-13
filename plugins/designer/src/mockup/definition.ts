import { defineWorkflow, Instruction } from "@corbits-builder/plugin";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import { type } from "arktype";
import manifest from "../../package.json";
import { conceptsAbout } from "../default-looks.ts";

export default defineWorkflow({
  input: type({
    "+": "reject",
    instruction: Instruction,
    lookIdeas: "string > 0",
    concepts: DesignConcept.array().atLeastLength(1).atMostLength(5),
    "createTheme?": "true",
    "audience?": "string > 0",
    "screens?": type("string > 0").array().atLeastLength(1),
  }),
  describe: {
    says: {
      doing: "Making the {thing} mockup",
      done: "Made the {thing} mockup",
    },
    summary:
      "Has a designer make a clickable, responsive HTML mockup of an interface for each concept, such as a web app, a mobile app's screens, a dashboard or a marketing page. Each is filed as a design option for the person to compare and choose from. A designer needs a theme and guidance to start: each concept is one of the looks below, or the project has the person's brand guidelines, fonts or colours saved, or createTheme asks for its theme to be made; and the project has filed requirements or an app, or audience and screens say what to design.",
    when: "The person wants to see how an interface could look: a mockup, design options to compare, or another pass on a design option.",
    unless:
      "They want something already built changed, or to pick fonts or colours on a screen.",
    fields: {
      instruction: {
        about:
          "What to design or change. The designer knows nothing of the conversation and cannot see an existing app. So this carries what kind of interface it is, what it is for and who uses it when no document says so, and, for something that exists, its screens and what they show.",
      },
      lookIdeas: {
        about:
          "The person's own ideas for the look, in their words, or that they left the look to you.",
      },
      concepts: { about: conceptsAbout(manifest.builder.design.looks) },
      createTheme: {
        about:
          "true when the person asked for a look of their own that none of the looks is, or described their brand in the conversation: a concept that is none of the looks then has its designer create its theme from the concept's direction and the person's words. Set it again on a later pass of such a concept. Leave it out otherwise.",
      },
      audience: {
        about:
          "Who uses the interface and what they come to it for, in a sentence, when the project has no filed requirements and no app to design from.",
      },
      screens: {
        about:
          "Each screen to design and what it is for, one per entry, when the project has no filed requirements and no app to design from.",
      },
    },
  },
});
