import { type } from "arktype";

const Color = /^#?[0-9A-Fa-f]{6}$/;
const Font = "0 < string <= 100";
const Text = "string > 0";

export const AssetRef = type({
  "+": "reject",
  artifact: Text,
  version: "number.integer > 0",
}).or({ "+": "reject", path: Text });
export type AssetRef = typeof AssetRef.infer;

export const Theme = type({
  "+": "reject",
  colors: {
    "+": "reject",
    primary: Color,
    secondary: Color,
    accent: Color,
    background: Color,
    text: Color,
    muted: Color,
  },
  fonts: { "+": "reject", heading: Font, body: Font },
  "logo?": AssetRef,
});
export type Theme = typeof Theme.infer;

const Fit = "'contain' | 'cover' = 'contain'";

export const Paragraph = type({
  "+": "reject",
  type: "'paragraph'",
  text: "string",
});

/** Blocks that flow as paragraphs in one text box; lists and rich runs join this union. */
export const TextBlock = Paragraph;
export type TextBlock = typeof TextBlock.infer;

export const ImageElement = type({
  "+": "reject",
  type: "'image'",
  image: AssetRef,
  fit: Fit,
});

/** Blocks that are shapes of their own; tables, charts and shapes join this union. */
export const Element = ImageElement;
export type Element = typeof Element.infer;

/** A region holds an ordered mix of blocks, which the writer stacks top to bottom. */
export const Block = TextBlock.or(Element);
export type Block = typeof Block.infer;
const Blocks = Block.array();

const slide = { "+": "reject", "notes?": "string" } as const;

const Column = type({ "+": "reject", heading: Text, body: Blocks });

export const Slide = type({
  ...slide,
  layout: "'title'",
  title: Text,
  "subtitle?": "string",
})
  .or({ ...slide, layout: "'section'", title: Text, "subtitle?": "string" })
  .or({ ...slide, layout: "'content'", title: Text, body: Blocks })
  .or({
    ...slide,
    layout: "'two-column'",
    title: Text,
    left: Blocks,
    right: Blocks,
  })
  .or({
    ...slide,
    layout: "'comparison'",
    title: Text,
    left: Column,
    right: Column,
  })
  .or({
    ...slide,
    layout: "'image'",
    "title?": Text,
    image: AssetRef,
    "caption?": "string",
    fit: Fit,
  })
  .or({ ...slide, layout: "'blank'", body: Blocks });
export type Slide = typeof Slide.infer;
export type Layout = Slide["layout"];

export const Deck = type({
  "+": "reject",
  theme: Theme,
  "footer?": { "+": "reject", "text?": "string", "slideNumbers?": "boolean" },
  slides: Slide.array().atLeastLength(1),
});
export type Deck = typeof Deck.infer;
export type DeckInput = typeof Deck.inferIn;

export type DeckIssue = {
  /** Zero-based index into `slides`, when the issue is inside one slide. */
  slide?: number;
  /** Where the issue is, such as `slides[2].title`. */
  path: string;
  message: string;
};

export type DeckValidation =
  | { ok: true; deck: Deck }
  | { ok: false; issues: DeckIssue[] };

export function validateDeck(input: unknown): DeckValidation {
  const deck = Deck(input);
  if (!(deck instanceof type.errors)) return { ok: true, deck };
  return {
    ok: false,
    issues: deck.map((error) => {
      const [field, index] = error.path;
      const path = error.propString || "deck";
      return field === "slides" && typeof index === "number"
        ? { slide: index, path, message: error.message }
        : { path, message: error.message };
    }),
  };
}

export const assetKey = (ref: AssetRef) =>
  "path" in ref
    ? `path:${ref.path}`
    : `artifact:${ref.artifact}@${ref.version}`;
