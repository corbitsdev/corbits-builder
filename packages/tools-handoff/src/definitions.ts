import { type } from "arktype";
import {
  DesignConcept,
  MATERIAL_KIND,
} from "@corbits-builder/schemas/artifact";
import {
  NativeDocumentKind,
  NativeSpecialistAssignment,
} from "@corbits-builder/schemas/native-specialist";
import { AskQuestions } from "@corbits-builder/schemas/questions";
import { APPROVABLE } from "./approvals.ts";
import type { HandoffConfig } from "./config.ts";

// A placeholder instruction repeated across turns ends the coordinator in a doom loop; a length
// floor the schema states gives it a refusal to act on instead.
const Instruction =
  NativeSpecialistAssignment.get("instruction").and("string >= 40");
export const DeployWriter = type({
  "+": "reject",
  kind: NativeDocumentKind,
  instruction: Instruction,
});
export const RequestApproval = type({
  "+": "reject",
  kinds: type
    .enumerated(...APPROVABLE, MATERIAL_KIND)
    .array()
    .atLeastLength(1),
});
export const ReviewArtifact = type({
  "+": "reject",
  kind: NativeDocumentKind.or("'problem_brief'"),
  instruction: Instruction,
});
export const DeployCoder = type({ "+": "reject", "instruction?": Instruction });
export const InstructCoder = type({ "+": "reject", instruction: Instruction });
export const DesignApp = type({
  "+": "reject",
  instruction: Instruction,
  lookIdeas: "string > 0",
  concepts: DesignConcept.array().atLeastLength(1).atMostLength(5),
});

export function handoffDefinitions(
  config: Pick<HandoffConfig, "designThemes" | "designConcepts">,
) {
  return [
    {
      name: "request_approval",
      description:
        "Ask the person to approve the filed documents of the given kinds, each at its current version; for material, every attached or imported material. One ask covers every document ready for the person, so list them all together, an earlier document with the ones that follow it. Ask for approval once the documents have no open questions left; open questions the person must decide go to them with ask_questions first. Their approval is what lets the writer of the next document start from them, and a changed document is approved again.",
      inputSchema: { ...RequestApproval.toJsonSchema() },
    },
    {
      name: "ask_questions",
      description:
        "Put up to five questions to the person, each shown as a card they answer. id is a short slug unique within the call. kind single takes one option and multi any number. preselected holds the option values you recommend, at most one for single. allowOther lets the person answer in their own words. Their answers arrive as their next message.",
      inputSchema: { ...AskQuestions.toJsonSchema() },
    },
    {
      name: "deploy_writer",
      description:
        "Have a writer write one document of the given kind from the filed documents. instruction says what the document must cover or correct; the writer sees only the filed documents and the instruction, so put in it anything the person said that the documents do not record. A writer starts once each earlier document is filed and a person approved its current version. A document can be rewritten at any time. The finished document arrives later as a message.",
      inputSchema: { ...DeployWriter.toJsonSchema() },
    },
    {
      name: "review_artifact",
      description:
        "Ask a reviewer for a second opinion on the filed document of the given kind, checked against the problem brief. instruction says what to check. The review arrives later as a message; it is advice for you to weigh, and approval stays with the person.",
      inputSchema: { ...ReviewArtifact.toJsonSchema() },
    },
    {
      name: "deploy_coder",
      description:
        "Have the coder build the whole app from the filed problem brief, constraints, approaches, product requirements, build plan and design. The documents are the assignment; an optional instruction adds a note to it. It starts once a person approved the current version of each document: the design by confirming a design option in the conversation, the others through request_approval.",
      inputSchema: { ...DeployCoder.toJsonSchema() },
    },
    {
      name: "instruct_coder",
      description:
        "Send a change to the coder that is already building: a fix, an addition or a correction. It continues in the same workspace. A person approves every instruction.",
      inputSchema: { ...InstructCoder.toJsonSchema() },
    },
    {
      name: "design_app",
      description:
        "Have the designer make or change the app's design from the filed problem brief, constraints, approaches and product requirements: a clickable, responsive mockup with a DESIGN.md of its tokens, screens, states and flows. The coder builds only from a filed design. instruction says what to design or change; a designer already working takes it in the same design. lookIdeas carries the person's own ideas for the look in their words, or that they left the look to you, and every designer works from it. The designer starts once a person approves the instruction. Each design arrives later as a message.\n\nWhen the person wants one suggested design, give one concept: the look you suggest, shaped by their ideas. When they want to explore several, give a concept for each look, up to the number of design concepts the person asked for. One designer per concept makes the design in that concept's look and files it as that concept's design_option for the person to compare; a designer already working on a concept takes the instruction in the same option. Choose concepts that differ clearly from one another, from this catalog or of your own that fit the idea better. Each catalog concept starts from a design theme (" +
        config.designThemes.map((theme) => theme.label).join(", ") +
        ") and its direction says how its designer adjusts that theme's tokens; a concept of your own starts from the kit's neutral theme, so its direction names the colours, type and radii it wants. When the person chose a theme, design that one concept, with the changes they asked for in its direction:\n" +
        config.designConcepts
          .map(({ label, direction }) => "- " + label + ": " + direction)
          .join("\n"),
      inputSchema: { ...DesignApp.toJsonSchema() },
    },
  ];
}
