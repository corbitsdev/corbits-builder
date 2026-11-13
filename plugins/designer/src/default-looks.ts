import type { DesignBuilder } from "@corbits-builder/plugin";

type Look = DesignBuilder["looks"][number];

const CONCEPTS =
  "The looks to design, each a label and a direction naming its colours, type and radii: one for a single suggested design, several clearly different ones to explore, at most five at a time. When the person has handed approvals over to Builder, give exactly one: that one design is made and used without asking them. A concept designed before gets a fresh designer that changes its latest draft.";

/**
 * What the coordinator reads of the mockup's concepts: with the looks the plugin declares, each by
 * the exact label that starts its designer from a ready theme.
 */
export function conceptsAbout(looks: readonly Look[]) {
  if (looks.length === 0) return CONCEPTS;
  return [
    `${CONCEPTS} Use these looks by their exact labels, with a direction shaped by the person's ideas; a label of yours that is none of them has no ready theme, so give one only when the person asked for a look of their own or the project has their brand, and see createTheme:`,
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
 * The designer's looks skill: each look it offers with the theme it starts from, and what each
 * theme is for, as the theme's own DESIGN.md says it.
 */
export function looksSkill(
  design: DesignBuilder,
  themeDocs: Readonly<Record<string, string>>,
) {
  const labelOf = (theme: string) =>
    design.looks.find(({ id }) => id === theme)?.label ?? theme;
  const themes = [
    ...new Set(design.looks.flatMap(({ theme }) => (theme ? [theme] : []))),
  ].flatMap((theme) => {
    const direction = directionOf(themeDocs[theme] ?? "");
    return direction ? [`### ${labelOf(theme)} theme\n\n${direction}`] : [];
  });
  return [
    "## Skill: Looks",
    "These are the looks Builder offers a person by name. When your concept is one of them, its theme's stylesheet is already in designs/styles.css: keep the theme's character and change only the tokens the direction names. When the task leaves the look to you, pick the look that suits who uses the product and the work they do there, and say why in your design brief. A look that is none of these has no ready theme: create one with the Create a theme skill before you draw.",
    "Each look, with the theme it starts from:",
    design.looks
      .map(
        ({ label, theme, direction }) =>
          `- ${label}${theme ? ` (${labelOf(theme)} theme)` : ""}: ${direction}`,
      )
      .join("\n"),
    "What each theme is for, from its own design:",
    ...themes,
  ].join("\n\n");
}
