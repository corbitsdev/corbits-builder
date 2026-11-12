import { coderTaskMessage } from "@corbits-builder/coder/contract";
import { themeOf } from "@corbits-builder/hub/config/design";
import { Refusal } from "@corbits-builder/plugin-host/coordinator";

// The filed documents a designer works from, read-only in its workspace.
export const DESIGNER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
] as const;

// A theme taken as it is is the concept's look; any other concept names the token changes it makes
// to the theme it starts from. It names the look, not what the workspace starts from, since a later
// pass continues the draft an earlier one left.
const lookOf = (concept: { label: string; direction: string }) => {
  const theme = themeOf(concept.label);
  if (
    theme?.label === concept.label &&
    theme.direction === concept.direction.trim()
  )
    return `Its look is the ${theme.label} theme as it is.`;
  return `Its look starts from the ${theme?.label ?? "kit's neutral"} theme and changes its tokens: ${concept.direction}`;
};

/**
 * What a designer's assignment says after its documents: the concept it designs, the person's own
 * ideas for the look in their words, and what to design or change.
 */
export const conceptAssignment = (
  concept: { label: string; direction: string },
  lookIdeas: string,
  instruction: string,
) =>
  `Design concept: ${concept.label}. ${lookOf(concept)}\nThe person compares this concept with any others before they pick one. file_design_option files it as this concept's option.\n\n` +
  `The person's ideas for the look, in their words: ${lookIdeas.trim()}\n\n` +
  coderTaskMessage(instruction);

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
