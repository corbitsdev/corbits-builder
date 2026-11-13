import { designThemeIds } from "@corbits-builder/designer/skills" with { type: "macro" };
import { HUB_NOTE_LEAD } from "./resume.ts";

// The looks the coordinator draws a varied set of design concepts from. Each starts from a design
// theme and says how its designer adjusts the theme's tokens. It may also propose a concept of its
// own that fits the idea better; that one starts from the kit's neutral theme.
export const DESIGN_CONCEPTS: readonly Readonly<{
  id: string;
  label: string;
  theme: string;
  direction: string;
}>[] = [
  {
    id: "modern-sleek",
    label: "Modern and sleek",
    theme: "modern-sleek",
    direction:
      "Crisp cool neutrals, one cobalt accent, generous whitespace, system sans-serif type and subtle depth.",
  },
  {
    id: "rounded-enterprise",
    label: "Rounded enterprise",
    theme: "modern-sleek",
    direction:
      "Friendly large radii (--radius about 1rem), a calm mid-blue primary and soft cool greys.",
  },
  {
    id: "boxy-enterprise",
    label: "Boxy enterprise",
    theme: "modern-sleek",
    direction:
      "Square corners (--radius 0), a deep navy primary and a sober, high-contrast palette of near-black text on white with hairline grey borders.",
  },
  {
    id: "dark-technical",
    label: "Dark and technical",
    theme: "modern-sleek",
    direction:
      "A dark canvas in both :root and .dark (near-black background, slate cards), a neon cyan primary and --font-sans set to ui-monospace, monospace.",
  },
  {
    id: "bold-colourful",
    label: "Bold and colourful",
    theme: "retro",
    direction:
      "Saturated colour: an electric magenta primary, bright yellow secondary and cyan accent on a white background.",
  },
  {
    id: "liquid-glass",
    label: "Liquid glass",
    theme: "liquid-glass",
    direction:
      "iOS-like frosted surfaces with background blur over vivid solid colour fields blurred into soft light, fluid curves and system type.",
  },
  {
    id: "pastel-soft",
    label: "Pastel and soft",
    theme: "modern-sleek",
    direction:
      "Muted pastel tints for the primary, secondary and accent, an off-white background, gentle contrast and large radii (--radius about 1rem).",
  },
  {
    id: "editorial",
    label: "Editorial",
    theme: "modern-sleek",
    direction:
      "Magazine-like: --font-sans set to ui-serif, Georgia, serif, an ink-black primary on a warm off-white background and restrained colour.",
  },
  {
    id: "warm-organic",
    label: "Warm and organic",
    theme: "retro",
    direction:
      'Earthy tones: a terracotta or olive primary, a cream background, soft brown borders and --font-sans set to Optima, Candara, "Segoe UI", sans-serif.',
  },
  {
    id: "minimal-monochrome",
    label: "Minimal monochrome",
    theme: "modern-sleek",
    direction:
      "Black, white and greys only: a near-black primary with white text on it, grey secondary and accent.",
  },
  {
    id: "retro",
    label: "Retro",
    theme: "retro",
    direction:
      "A nostalgic cream, tomato, mustard and teal palette, chunky ink outlines, 70s display type and tactile, toy-like controls.",
  },
  {
    id: "trading-desk",
    label: "Dense trading desk",
    theme: "modern-sleek",
    direction:
      "For experts: a dark slate canvas in both :root and .dark, a muted blue primary, small radii (--radius 0.25rem), and --success and --destructive kept for gains and losses.",
  },
  {
    id: "enthusiast-forum",
    label: "Enthusiast forum",
    theme: "retro",
    direction:
      'A long-running hobby forum: a faded navy primary on parchment, small radii (--radius 0.25rem) and --font-sans set to "Arial Narrow", "Roboto Condensed", sans-serif.',
  },
];

const THEMED = new Set(designThemeIds());

// The catalog concepts that are design themes themselves, in catalog order.
export const DESIGN_THEMES = DESIGN_CONCEPTS.filter((concept) =>
  THEMED.has(concept.id),
);

// The theme a concept starts from: its catalog entry's theme. A concept of the coordinator's own
// has none and starts from the kit's neutral theme.
export const themeOf = (label: string) => {
  const concept = DESIGN_CONCEPTS.find(
    (entry) => entry.label.toLowerCase() === label.trim().toLowerCase(),
  );
  return concept && DESIGN_THEMES.find((theme) => theme.id === concept.theme);
};

// The hub's note to the coordinator once the person chose a design option in the conversation.
export const designChosenNote = (concept: string, version: number) =>
  `${HUB_NOTE_LEAD}Design chosen: ${concept}.\n\nThe person chose the ${concept} design concept. It is filed as the design at version ${String(version)}, approved by them. The build plan is written from it next.`;
