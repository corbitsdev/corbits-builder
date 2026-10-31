import type { HandoffConfig } from "@corbits-builder/tools-handoff";
import { DEFAULT_STACK } from "../config/packages.ts";
import { CODER_INPUTS, DESIGNER_INPUTS, startHere } from "../config/inputs.ts";
import {
  agentDecidesApprovals,
  asksOpenQuestions,
  designConceptCount,
  preferenceBlock,
} from "../config/preferences.ts";
import {
  DESIGN_CONCEPTS,
  DESIGN_THEMES,
  designConceptAssignment,
  designLookIdeas,
} from "../config/design.ts";
import { QUESTIONS_ASKED } from "../config/questions.ts";
import { assignmentToWriterMessage } from "../workflows/writer-task.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";

export const handoffConfig: HandoffConfig = {
  failure: projectScopeFailure,
  questionsAsked: QUESTIONS_ASKED,
  defaultStack: DEFAULT_STACK,
  designThemes: DESIGN_THEMES,
  designConcepts: DESIGN_CONCEPTS,
  designConceptAssignment,
  designLookIdeas,
  designerInputs: DESIGNER_INPUTS,
  coderInputs: CODER_INPUTS,
  startHere,
  agentDecidesApprovals,
  asksOpenQuestions,
  designConceptCount,
  preferenceBlock,
  assignmentToWriterMessage,
};
