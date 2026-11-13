import { coderTaskMessage } from "@corbits-builder/coder/contract";
import { lookOf } from "@corbits-builder/plugin";
import { Refusal } from "@corbits-builder/plugin-host/coordinator";
import manifest from "../package.json";

// The filed documents a designer works from, read-only in its workspace.
export const DESIGNER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
] as const;

// A theme taken as it is is the concept's look; any other concept names the token changes it makes
// to the theme it starts from. It names the look, not what the workspace starts from, since a later
// pass continues the draft an earlier one left. A concept with no theme behind it is told so, since
// its workspace starts on the starter's plain kit tokens.
const look = (concept: { label: string; direction: string }) => {
  const { design } = manifest.builder;
  const started = lookOf(design, concept.label);
  const theme = started && design.looks.find(({ id }) => id === started.theme);
  if (!theme)
    return `No theme is ready for this look: designs/styles.css starts with the starter's plain kit tokens. Create its theme first with the Create a theme skill, from this direction, the person's ideas below and any brand values the project has: ${concept.direction}`;
  if (
    theme.label === concept.label &&
    theme.direction === concept.direction.trim()
  )
    return `Its look is the ${theme.label} theme as it is.`;
  return `Its look starts from the ${theme.label} theme and changes its tokens: ${concept.direction}`;
};

/** What a mockup call gives each of its designers besides its concept. */
export type DesignTask = {
  instruction: string;
  lookIdeas: string;
  audience?: string | undefined;
  screens?: readonly string[] | undefined;
};

/**
 * What a designer's assignment says after its documents: the concept it designs, the person's own
 * ideas for the look in their words, who it is for and its screens when the call names them, and
 * what to design or change.
 */
export const conceptAssignment = (
  concept: { label: string; direction: string },
  { instruction, lookIdeas, audience, screens }: DesignTask,
) =>
  [
    `Design concept: ${concept.label}. ${look(concept)}\nThe person compares this concept with any others before they pick one. file_design_option files it as this concept's option.`,
    `The person's ideas for the look, in their words: ${lookIdeas.trim()}`,
    ...(audience === undefined ? [] : [`Who it is for: ${audience.trim()}`]),
    ...(screens === undefined
      ? []
      : [
          `The screens to design:\n${screens.map((screen) => `- ${screen.trim()}`).join("\n")}`,
        ]),
    coderTaskMessage(instruction),
  ].join("\n\n");

// Each pass on a concept is its own designer, one at a time. Without live, the other is still
// starting, from another call in the same turn.
export const designerBusy = (concept: string, live?: { runId: string }) =>
  new Refusal(
    live === undefined
      ? "designer_starting: a designer is already starting for this project"
      : "designer_running: the " +
          concept +
          " designer is still working in run " +
          live.runId +
          "; its design arrives as a message, and the next pass on it can start after",
  );
