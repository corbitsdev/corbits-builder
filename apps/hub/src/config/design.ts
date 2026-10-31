import { designThemeIds } from "@corbits-builder/designer/skills" with { type: "macro" };

// The product standard every generated app is held to. It is product wording, so it lives in
// config beside the other user-visible text; the components and the stack's docs are skills.
export const DESIGN_STANDARD = `Product standard
The app is a product. It has one app shell: a left sidebar or a top bar for navigation, reachable at every width (a drawer from the top bar on a phone). Each screen has a clear hierarchy: one title, one primary action, then its content, built from @corbits/react-ui components on the theme's spacing, type and colour tokens, and everything fits its container. Empty, loading and error states are designed.

Every must in the requirements is on screen with real data, real units and sensible formatting (locale dates, rounded numbers, relative times such as "updated 2 min ago"). Where the requirements name an information item, it is visible without digging. Names beat identifiers: show the city, not coordinates. Say where data comes from and when it was last updated.

Your skills hold the components to build with and where each tool's docs start.`;

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

// A theme taken as it is starts with its look in place; any other concept names the token changes
// it makes to the theme it starts from.
const startingPoint = (concept: { label: string; direction: string }) => {
  const theme = themeOf(concept.label);
  if (
    theme?.label === concept.label &&
    theme.direction === concept.direction.trim()
  )
    return `Your .builder starts from the ${theme.label} theme, which is this concept's look.`;
  return `Your .builder starts from the ${theme?.label ?? "kit's neutral"} theme, and this concept changes its tokens: ${concept.direction}`;
};

export const designConceptAssignment = (concept: {
  label: string;
  direction: string;
}) =>
  `Design concept: ${concept.label}. ${startingPoint(concept)}\nThe person compares this concept with any others before they pick the one to build. file_design_option files it as this concept's option.\n\n`;

// The person's own ideas for the look, carried to each designer in their words.
export const designLookIdeas = (ideas: string) =>
  `The person's ideas for the look, in their words: ${ideas.trim()}\n\n`;

// The hub's note to the coordinator once the person chose a design option in the conversation.
export const designChosenNote = (concept: string, version: number) =>
  `The person chose the ${concept} design concept. It is filed as the design at version ${String(version)}, approved by them. The build plan is written from it next.`;
