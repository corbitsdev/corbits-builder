import { scope, type } from "arktype";

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

export const ThemeColor = type(
  "'primary' | 'secondary' | 'accent' | 'background' | 'text' | 'muted'",
);
export type ThemeColor = typeof ThemeColor.infer;

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const Url = type("string").narrow(
  (text, ctx) =>
    (URL.canParse(text) && LINK_PROTOCOLS.has(new URL(text).protocol)) ||
    ctx.mustBe("an http, https or mailto URL"),
);

/** A URL, or a slide as a zero-based index into `slides` like the paths in validation issues. */
export const Link = Url.or("number.integer >= 0");
export type Link = typeof Link.infer;

export const Run = type({
  "+": "reject",
  text: "string",
  "bold?": "boolean",
  "italic?": "boolean",
  "underline?": "boolean",
  "strike?": "boolean",
  "color?": ThemeColor.or(Color),
  /** Points. */
  "size?": "1 <= number <= 400",
  "link?": Link,
});
export type Run = typeof Run.infer;

/** A plain string, or runs that may each be a plain string. */
export const RichText = type("string").or(type("string").or(Run).array());
export type RichText = typeof RichText.infer;

export const Paragraph = type({
  "+": "reject",
  type: "'paragraph'",
  text: RichText,
});

/** A list item is text, or text with nested items, which are numbered like their parent unless `ordered` says otherwise. */
export const { ListItem } = scope({
  RichText,
  ListItem: [
    "RichText",
    "|",
    {
      "+": "reject",
      text: "RichText",
      "ordered?": "boolean",
      items: "ListItem[] >= 1",
    },
  ],
}).export();
export type ListItem = typeof ListItem.infer;

/** How deep lists nest; the writer styles each level from the master. */
export const LIST_DEPTH = 5;

export const List = type({
  "+": "reject",
  type: "'list'",
  ordered: "boolean = false",
  items: ListItem.array().atLeastLength(1),
});
export type List = typeof List.infer;

/** Blocks that flow as paragraphs in one text box. */
export const TextBlock = Paragraph.or(List);
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

/** The block lists on a slide, with their path under the slide. */
export function slideRegions(slide: Slide) {
  switch (slide.layout) {
    case "content":
    case "blank":
      return [{ role: "body", path: "body", blocks: slide.body }] as const;
    case "two-column":
      return [
        { role: "left", path: "left", blocks: slide.left },
        { role: "right", path: "right", blocks: slide.right },
      ] as const;
    case "comparison":
      return [
        { role: "left", path: "left.body", blocks: slide.left.body },
        { role: "right", path: "right.body", blocks: slide.right.body },
      ] as const;
    default:
      return [];
  }
}

type Path = (string | number)[];

function pathKey(key: string | number, index: number) {
  if (typeof key === "number") return `[${key}]`;
  if (index === 0) return key;
  return `.${key}`;
}

const pathString = (path: Path) => path.map(pathKey).join("");

function issueAt(path: Path, message: string): DeckIssue {
  const [, slide] = path;
  const where = pathString(path);
  return typeof slide === "number"
    ? { slide, path: where, message: `${where} ${message}` }
    : { path: where, message: `${where} ${message}` };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Lists nested past LIST_DEPTH, found without recursion before the schema's own recursion can overflow. */
function deepLists(input: unknown): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const pending = [
    {
      value: isObject(input) ? input.slides : undefined,
      path: ["slides"] as Path,
      depth: 0,
    },
  ];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { value, path, depth } = next;
    if (!isObject(value)) continue;
    const entries = Object.entries(value).reverse();
    const opensList =
      Array.isArray(value.items) && (depth > 0 || value.type === "list");
    for (const [key, child] of entries) {
      const childPath = [...path, Array.isArray(value) ? Number(key) : key];
      if (key !== "items" || !opensList)
        pending.push({ value: child, path: childPath, depth });
      else if (depth < LIST_DEPTH)
        pending.push({ value: child, path: childPath, depth: depth + 1 });
      else
        issues.push(
          issueAt(childPath, `nests lists deeper than ${LIST_DEPTH} levels`),
        );
    }
  }
  return issues;
}

function* textRuns(text: RichText, path: Path): Generator<[Run, Path]> {
  if (typeof text === "string") return;
  for (const [index, run] of text.entries())
    if (typeof run !== "string") yield [run, [...path, index]];
}

function* itemRuns(
  items: readonly ListItem[],
  path: Path,
): Generator<[Run, Path]> {
  for (const [index, item] of items.entries()) {
    if (typeof item === "string" || Array.isArray(item)) {
      yield* textRuns(item, [...path, index]);
      continue;
    }
    yield* textRuns(item.text, [...path, index, "text"]);
    yield* itemRuns(item.items, [...path, index, "items"]);
  }
}

function* slideRuns(slide: Slide, index: number): Generator<[Run, Path]> {
  for (const region of slideRegions(slide))
    for (const [position, block] of region.blocks.entries()) {
      const path = ["slides", index, region.path, position];
      if (block.type === "paragraph")
        yield* textRuns(block.text, [...path, "text"]);
      else if (block.type === "list")
        yield* itemRuns(block.items, [...path, "items"]);
    }
}

function missingSlideLinks({ slides }: Deck): DeckIssue[] {
  return slides
    .flatMap((slide, index) => [...slideRuns(slide, index)])
    .filter(
      ([run]) => typeof run.link === "number" && run.link >= slides.length,
    )
    .map(([run, path]) =>
      issueAt(
        [...path, "link"],
        `links to slide ${run.link}, but the deck has ${slides.length} slides`,
      ),
    );
}

export function validateDeck(input: unknown): DeckValidation {
  const tooDeep = deepLists(input);
  if (tooDeep.length > 0) return { ok: false, issues: tooDeep };
  const deck = Deck(input);
  if (!(deck instanceof type.errors)) {
    const issues = missingSlideLinks(deck);
    return issues.length === 0 ? { ok: true, deck } : { ok: false, issues };
  }
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
