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

/** Free-form slides are laid out in CSS pixels on this canvas, which is the slide at 96 pixels per inch. */
export const CANVAS = { width: 1280, height: 720 } as const;

const Fraction = "0 <= number <= 1";
const Pixels = "number >= 0";
const Side = type("'left' | 'right' | 'top' | 'bottom'");
export type Side = typeof Side.infer;
const Paintable = ThemeColor.or(Color);

const GradientStop = type({
  "+": "reject",
  color: Paintable,
  /** Percent along the gradient. */
  at: "0 <= number <= 100",
  "opacity?": Fraction,
});

/** A colour, or a gradient of two or more stops; a linear angle is in CSS degrees, where 180 runs top to bottom. */
export const Paint = Paintable.or({
  "+": "reject",
  type: "'linear'",
  angle: "number = 180",
  stops: GradientStop.array().atLeastLength(2),
}).or({
  "+": "reject",
  type: "'radial'",
  stops: GradientStop.array().atLeastLength(2),
});
export type Paint = typeof Paint.infer;

export const Border = type({
  "+": "reject",
  width: "number > 0",
  color: Paintable,
  "opacity?": Fraction,
  dash: "'solid' | 'dash' | 'dot' = 'solid'",
});
export type Border = typeof Border.infer;

/** An outer shadow, as CSS box-shadow describes one. */
export const Shadow = type({
  "+": "reject",
  x: "number",
  y: "number",
  blur: Pixels,
  spread: "number = 0",
  color: Paintable,
  opacity: "0 <= number <= 1 = 1",
});
export type Shadow = typeof Shadow.infer;

/** One radius, or per corner in CSS order: top left, top right, bottom right, bottom left. */
const Radius = type(Pixels).or([Pixels, Pixels, Pixels, Pixels]);
export type Radius = typeof Radius.infer;

/** Position and size in canvas pixels; `id` names the element for animations and for Morph. */
const placed = {
  "+": "reject",
  "id?": Text,
  x: "number",
  y: "number",
  w: Pixels,
  h: Pixels,
  /** Clockwise degrees. */
  "rotation?": "number",
  "opacity?": Fraction,
  "link?": Link,
} as const;

export const FreeRun = type({
  "+": "reject",
  /** A newline is a line break. */
  text: "string",
  "font?": Font,
  /** Pixels; PowerPoint's smallest size is one point, which is 4/3 of a pixel. */
  "size?": "1.34 <= number <= 500",
  "weight?": "100 <= number.integer <= 900",
  "italic?": "boolean",
  "underline?": "boolean",
  "strike?": "boolean",
  "color?": Paint,
  /** Pixels between letters. */
  "letterSpacing?": "-100 <= number <= 100",
  "link?": Link,
});
export type FreeRun = typeof FreeRun.infer;

export const FreeParagraph = type({
  "+": "reject",
  runs: type("string").or(FreeRun).array(),
  align: "'left' | 'center' | 'right' | 'justify' = 'left'",
  /** Pixels from one baseline to the next. */
  "lineHeight?": "0 < number <= 2000",
  spaceBefore: "0 <= number <= 2000 = 0",
  spaceAfter: "0 <= number <= 2000 = 0",
});
export type FreeParagraph = typeof FreeParagraph.infer;

export const TextElement = type({
  ...placed,
  type: "'text'",
  paragraphs: FreeParagraph.array().atLeastLength(1),
  anchor: "'top' | 'middle' | 'bottom' = 'top'",
  /** Off, the text keeps the breaks it was given. */
  wrap: "boolean = true",
  /** Pixels; none when left out. */
  "insets?": {
    "+": "reject",
    top: Pixels,
    right: Pixels,
    bottom: Pixels,
    left: Pixels,
  },
  "fill?": Paint,
  "border?": Border,
  "shadow?": Shadow,
});
export type TextElement = typeof TextElement.infer;

const shape = {
  ...placed,
  type: "'shape'",
  "fill?": Paint,
  "border?": Border,
  "shadow?": Shadow,
} as const;

/** A line runs from the top left to the bottom right of its box, mirrored by `flip`, and draws with its border. */
export const ShapeElement = type({ ...shape, geometry: "'rect' | 'ellipse'" })
  .or({ ...shape, geometry: "'roundRect'", radius: Radius })
  .or({
    ...placed,
    type: "'shape'",
    geometry: "'line'",
    "flip?": "'horizontal' | 'vertical'",
    border: Border,
    "shadow?": Shadow,
  });
export type ShapeElement = typeof ShapeElement.infer;

/** `image` is a PNG or JPEG; with `svg`, viewers that read SVG draw it and the rest fall back to `image`. */
export const PictureElement = type({
  ...placed,
  w: "number > 0",
  h: "number > 0",
  type: "'image'",
  image: AssetRef,
  "svg?": AssetRef,
  fit: "'fill' | 'contain' | 'cover' = 'fill'",
  /** Fractions of the image cut from each side; used with fit 'fill'. */
  "crop?": {
    "+": "reject",
    top: Fraction,
    right: Fraction,
    bottom: Fraction,
    left: Fraction,
  },
  "radius?": Radius,
  "border?": Border,
  "shadow?": Shadow,
});
export type PictureElement = typeof PictureElement.infer;

/** How deep groups nest. */
export const GROUP_DEPTH = 10;

/** Children are in canvas pixels too; later elements, here and on the slide, draw on top. */
export const { FreeElement } = scope({
  TextElement,
  ShapeElement,
  PictureElement,
  FreeElement: [
    "TextElement | ShapeElement | PictureElement",
    "|",
    {
      "+": "reject",
      "id?": Text,
      type: "'group'",
      "opacity?": Fraction,
      children: "FreeElement[] >= 1",
    },
  ],
}).export();
export type FreeElement = typeof FreeElement.infer;
export type GroupElement = Extract<FreeElement, { type: "group" }>;

const Milliseconds = "0 <= number.integer <= 3600000";

export const Transition = type({
  "+": "reject",
  type: "'fade' | 'morph'",
  duration: "100 <= number.integer <= 60000 = 700",
}).or({
  "+": "reject",
  type: "'push' | 'wipe'",
  from: Side.default("right"),
  duration: "100 <= number.integer <= 60000 = 700",
});
export type Transition = typeof Transition.infer;

const PATH_ARGUMENTS: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0, E: 0 };

/** OOXML motion path syntax: M, L, C, Z and E with numbers as fractions of the slide, relative to where the element starts. */
const MotionPath = type("string").narrow((path, ctx) => {
  const tokens = path.trim().split(/[\s,]+/);
  if (tokens[0] !== "M") return ctx.mustBe("a path starting with M");
  for (let at = 0; at < tokens.length;) {
    const count = PATH_ARGUMENTS[tokens[at] ?? ""];
    if (count === undefined)
      return ctx.mustBe("a path of M, L, C, Z and E commands with numbers");
    const numbers = tokens.slice(at + 1, at + 1 + count);
    if (
      numbers.length < count ||
      numbers.some((n) => !Number.isFinite(Number(n)))
    )
      return ctx.mustBe(`a path whose ${tokens[at]} has ${count} numbers`);
    at += 1 + count;
  }
  return true;
});

const animation = {
  "+": "reject",
  /** The `id` of an element directly on the same slide; a group animates as a whole. */
  target: Text,
  trigger: "'onClick' | 'withPrevious' | 'afterPrevious' = 'onClick'",
  duration: "1 <= number.integer <= 3600000 = 500",
  delay: `${Milliseconds} = 0`,
  /** Fractions of the duration spent speeding up and slowing down. */
  "easing?": { "+": "reject", accel: Fraction, decel: Fraction },
  /** Times to play, or 'indefinite'. */
  "repeat?": type("1 <= number <= 1000").or("'indefinite'"),
} as const;

/** Played in array order; each trigger is relative to the animation before it. */
export const Animation = type({
  ...animation,
  effect: "'fade' | 'zoom'",
  kind: "'entrance' | 'exit'",
})
  .or({
    ...animation,
    effect: "'fly' | 'wipe'",
    kind: "'entrance' | 'exit'",
    /** The edge the element enters from or exits to. */
    side: Side,
  })
  .or({ ...animation, effect: "'spin'", degrees: "number = 360" })
  .or({ ...animation, effect: "'scale'", scale: "0 < number <= 100 = 1.5" })
  .or({ ...animation, effect: "'pulse'" })
  .or({ ...animation, effect: "'path'", path: MotionPath });
export type Animation = typeof Animation.infer;

/** A region holds an ordered mix of blocks, which the writer stacks top to bottom. */
export const Block = TextBlock.or(Element);
export type Block = typeof Block.infer;
const Blocks = Block.array();

const slide = {
  "+": "reject",
  "notes?": "string",
  "transition?": Transition,
} as const;

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
  .or({ ...slide, layout: "'blank'", body: Blocks })
  .or({
    ...slide,
    layout: "'free'",
    "background?": Paint,
    elements: FreeElement.array(),
    "animations?": Animation.array(),
  });
export type Slide = typeof Slide.infer;
/** The layouts with placeholders; a free slide draws on the blank layout. */
export type Layout = Exclude<Slide["layout"], "free">;

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

const NESTING = [
  {
    key: "items",
    limit: LIST_DEPTH,
    noun: "lists",
    opens: (value: Record<string, unknown>, depth: number) =>
      depth > 0 || value.type === "list",
  },
  {
    key: "children",
    limit: GROUP_DEPTH,
    noun: "groups",
    opens: (value: Record<string, unknown>) => value.type === "group",
  },
] as const;

/** Lists and groups nested past their limits, found without recursion before the schema's own recursion can overflow. */
function deepNesting(input: unknown): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const pending = [
    {
      value: isObject(input) ? input.slides : undefined,
      path: ["slides"] as Path,
      depths: NESTING.map(() => 0),
    },
  ];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { value, path, depths } = next;
    if (!isObject(value)) continue;
    const entries = Object.entries(value).reverse();
    for (const [key, child] of entries) {
      const childPath = [...path, Array.isArray(value) ? Number(key) : key];
      const level = NESTING.findIndex(
        (nesting, index) =>
          key === nesting.key &&
          Array.isArray(child) &&
          nesting.opens(value, depths[index] ?? 0),
      );
      const nesting = NESTING[level];
      const depth = depths[level] ?? 0;
      if (!nesting) pending.push({ value: child, path: childPath, depths });
      else if (depth < nesting.limit)
        pending.push({
          value: child,
          path: childPath,
          depths: depths.map((each, index) =>
            index === level ? each + 1 : each,
          ),
        });
      else
        issues.push(
          issueAt(
            childPath,
            `nests ${nesting.noun} deeper than ${nesting.limit} levels`,
          ),
        );
    }
  }
  return issues;
}

/** Every element on a free slide with its path, groups before their children, without recursion. */
export function* freeElements(
  elements: readonly FreeElement[],
  path: Path,
): Generator<[FreeElement, Path]> {
  const pending = elements
    .map((element, index): [FreeElement, Path] => [element, [...path, index]])
    .reverse();
  for (let next = pending.pop(); next; next = pending.pop()) {
    yield next;
    const [element, at] = next;
    if (element.type === "group")
      pending.push(
        ...element.children
          .map((child, index): [FreeElement, Path] => [
            child,
            [...at, "children", index],
          ])
          .reverse(),
      );
  }
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

type Linked = { link?: Link };

function* slideRuns(slide: Slide, index: number): Generator<[Linked, Path]> {
  if (slide.layout === "free")
    for (const [element, path] of freeElements(slide.elements, [
      "slides",
      index,
      "elements",
    ])) {
      if (element.type !== "group") yield [element, path];
      if (element.type !== "text") continue;
      for (const [number, paragraph] of element.paragraphs.entries())
        for (const [position, run] of paragraph.runs.entries())
          if (typeof run !== "string")
            yield [run, [...path, "paragraphs", number, "runs", position]];
    }
  for (const region of slideRegions(slide))
    for (const [position, block] of region.blocks.entries()) {
      const path = ["slides", index, region.path, position];
      if (block.type === "paragraph")
        yield* textRuns(block.text, [...path, "text"]);
      else if (block.type === "list")
        yield* itemRuns(block.items, [...path, "items"]);
    }
}

/** Duplicate ids, animations PowerPoint cannot play, and crops and shadows it cannot draw. */
function freeSlideIssues(slide: Slide, index: number): DeckIssue[] {
  if (slide.layout !== "free") return [];
  const issues: DeckIssue[] = [];
  const ids = new Set<string>();
  const grouped = new Set<string>();
  const slidePath = ["slides", index, "elements"];
  for (const [element, path] of freeElements(slide.elements, slidePath)) {
    if (element.id !== undefined && ids.has(element.id))
      issues.push(
        issueAt(
          [...path, "id"],
          `repeats the id "${element.id}" on this slide`,
        ),
      );
    if (element.id !== undefined) ids.add(element.id);
    if (element.id !== undefined && path.length > slidePath.length + 1)
      grouped.add(element.id);
    if (element.type === "group") continue;
    if (element.type === "image" && element.crop) {
      const { top, right, bottom, left } = element.crop;
      if (element.fit !== "fill")
        issues.push(
          issueAt([...path, "crop"], `needs fit 'fill', not '${element.fit}'`),
        );
      if (left + right >= 1 || top + bottom >= 1)
        issues.push(
          issueAt([...path, "crop"], "cuts away the whole image on one axis"),
        );
    }
    if (
      element.shadow &&
      element.shadow.spread < -Math.min(element.w, element.h) / 2
    )
      issues.push(
        issueAt(
          [...path, "shadow", "spread"],
          "shrinks the shadow past nothing; it can be no less than minus half the shorter side",
        ),
      );
  }
  let endless = false;
  for (const [position, animation] of (slide.animations ?? []).entries()) {
    const path = ["slides", index, "animations", position];
    if (!ids.has(animation.target))
      issues.push(
        issueAt(
          [...path, "target"],
          `names "${animation.target}", which no element on this slide has as its id`,
        ),
      );
    if (grouped.has(animation.target))
      issues.push(
        issueAt(
          [...path, "target"],
          `names "${animation.target}", which is inside a group; animate the whole group or an element directly on the slide`,
        ),
      );
    if (animation.trigger === "afterPrevious" && endless)
      issues.push(
        issueAt(
          [...path, "trigger"],
          "waits for an animation that repeats indefinitely and never ends",
        ),
      );
    if (animation.trigger !== "withPrevious") endless = false;
    if (animation.repeat === "indefinite") endless = true;
    if (animation.easing && animation.easing.accel + animation.easing.decel > 1)
      issues.push(
        issueAt([...path, "easing"], "has accel and decel adding up past 1"),
      );
  }
  return issues;
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
  const tooDeep = deepNesting(input);
  if (tooDeep.length > 0) return { ok: false, issues: tooDeep };
  const deck = Deck(input);
  if (!(deck instanceof type.errors)) {
    const issues = [
      ...deck.slides.flatMap(freeSlideIssues),
      ...missingSlideLinks(deck),
    ];
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
