import type { DesignBuilder } from "@corbits-builder/plugin";

type Look = DesignBuilder["looks"][number];

const CONCEPTS =
  "The designs to make, each a label and a direction: one for a single suggested design, several clearly different ones to explore, at most five at a time. When the person has handed approvals over to Builder, give exactly one: that one design is made and used without asking them. A concept designed before gets a fresh designer that changes its latest draft.";

/**
 * What the coordinator reads of the mockup's concepts: with the looks the plugin declares, each a
 * theme by the exact label that starts its designer from it.
 */
export function conceptsAbout(looks: readonly Look[]) {
  if (looks.length === 0) return CONCEPTS;
  return [
    `${CONCEPTS} Each label is one of these themes by its exact label, chosen for who uses the product and the work they do there, and its direction says in a sentence why it suits them, which the person reads beside the design. The theme carries the whole look, so write no colours, type or layout. A label that is none of them has no theme yet: give one only when the person asked for a look of their own or gave their brand, with createTheme, and its direction is that brand or idea in their words:`,
    ...looks.map(({ label, direction }) => `- ${label}: ${direction}`),
  ].join("\n");
}

// A theme's DESIGN.md says what its look is for under Direction.
const directionOf = (designDoc: string) =>
  designDoc
    .split(/^## Direction\n/m)[1]
    ?.split(/^## /m)[0]
    ?.trim();

/**
 * The designer's looks skill: each theme it offers, with what it is for as the theme's own DESIGN.md
 * says it.
 */
export function looksSkill(
  design: DesignBuilder,
  themeDocs: Readonly<Record<string, string>>,
) {
  const themes = design.looks.flatMap(({ label, theme }) => {
    const doc = theme && themeDocs[theme];
    const direction = doc && directionOf(doc);
    return direction ? [`### ${label} theme\n\n${direction}`] : [];
  });
  return [
    "## Skill: Looks",
    "These are the themes Builder offers a person by name, each with what it is for. When your concept is one of them, its stylesheet is already in designs/styles.css and its full foundations are in your task: follow them. A look that is none of them has no ready theme: create one with the Create a theme skill before you draw.",
    ...themes,
  ].join("\n\n");
}
