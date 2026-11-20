/**
 * A written document read as a printed page: a sheet on the window's backdrop with a small running
 * header, the document's title and its body. The pane's one bar heads it with the version, the page
 * being read, the zoom and the download; the document's sections sit to the left; the right margin
 * holds whatever is placed beside a passage, level with it.
 */
import { Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Fault } from "../../components.tsx";
import { wording } from "../../config.ts";
import {
  DocumentContents,
  type DocumentSection,
} from "./document-contents.tsx";
import { PaneBar, type PaneBarGroup } from "./pane-bar.tsx";
import styles from "./document-page.module.css";

/**
 * Where a passage's comment stands, beyond waiting to be taken up: selected while it is written,
 * being made into a change, or changed in the version shown.
 */
export type PassageState = "selected" | "making" | "changed";

/** A passage something is said about, by the words it quotes from the page. */
export type MarginPassage = { id: string; quote: string; state?: PassageState };

/** Where a passage sits: its top, from the top of the margin, and the section it is in. */
export type PassagePlace = MarginPassage & {
  top: number;
  section: string | null;
};

/** How the document's writing stands, while it is not yet filed whole. */
export type PageWriting = "live" | "stopped";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PageZoom = (typeof ZOOMS)[number];
// Where the reader's eye rests, as a share of the view's height: the page it is in is the one
// being read.
const READING_LINE = 0.4;
// A heading a jump landed on reads as reached though it rests a pixel or two short of the line.
const LANDING_SLACK = 4;
// A jump has settled once the view has not moved for this long.
const JUMP_SETTLE_MS = 150;
// Keys that scroll the view.
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
// A margin item starts a little above its passage, so its first line sits level with it.
const MARGIN_LEAD = 15;
const MARGIN_GAP = 8;
// A margin item is a card this wide; with less room than that beside the page, the margin stays
// empty and the underlines alone mark the passages. The stylesheet takes the width from here.
const CARD_WIDTH = 280;
// Cards sit --space-8 clear of the page and want --space-6 clear of the pane's edge.
const MARGIN_INSET = 32 + 24;
// Each state is its own highlight, named as the stylesheet paints it.
const HIGHLIGHTS: Readonly<Record<PassageState | "commented", string>> = {
  commented: "document-passage",
  selected: "document-passage-selected",
  making: "document-passage-making",
  changed: "document-passage-changed",
};

type Painted = { highlight: string; range: Range };
// Every page on screen shares one highlight registry, so each keeps its own ranges here.
const painted = new Map<object, readonly Painted[]>();
function paint(owner: object, marks: readonly Painted[]) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  if (marks.length === 0) painted.delete(owner);
  else painted.set(owner, marks);
  const all = [...painted.values()].flat();
  for (const highlight of Object.values(HIGHLIGHTS)) {
    const ranges = all
      .filter((mark) => mark.highlight === highlight)
      .map((mark) => mark.range);
    if (ranges.length === 0) CSS.highlights.delete(highlight);
    else CSS.highlights.set(highlight, new Highlight(...ranges));
  }
}

/**
 * Finds quotes in the page's text, across inline elements: each quote is its first run there.
 * The text is read once, so every passage on the page is found from one pass over it.
 */
function quoteFinder(root: HTMLElement): (quote: string) => Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += node.textContent ?? "";
  }
  return (quote) => {
    const at = quote.length === 0 ? -1 : text.indexOf(quote);
    if (at === -1) return null;
    const end = at + quote.length;
    const from = nodes.findLast((entry) => entry.start <= at);
    const to = nodes.findLast((entry) => entry.start < end);
    if (from === undefined || to === undefined) return null;
    const range = document.createRange();
    range.setStart(from.node, at - from.start);
    range.setEnd(to.node, end - to.start);
    return range;
  };
}

function same<T>(
  was: readonly T[],
  now: readonly T[],
  equal: (a: T, b: T) => boolean,
): boolean {
  return (
    was.length === now.length &&
    was.every((item, index) => {
      const other = now[index];
      return other !== undefined && equal(item, other);
    })
  );
}

/**
 * The section being read: the last whose heading has reached the top of the view, where a jump to
 * it lands. A section whose heading never can, near the end of a document, is reached at the end:
 * scrolled to the foot, the last heading in view is the one being read. Null above the first.
 */
export function sectionRead(
  headings: readonly { id: string; top: number }[],
  line: number,
  end: number | null,
): string | null {
  const reached = (top: number) => top <= (end ?? line);
  return headings.findLast((heading) => reached(heading.top))?.id ?? null;
}

/** The document's sections: its headings at the top level it uses, with their anchors. */
function readSections(body: HTMLElement): HTMLElement[] {
  const headings = [
    ...body.querySelectorAll<HTMLElement>(
      '[data-slot="prose"] > :is(h2, h3, h4)[id]',
    ),
  ];
  const top = Math.min(
    ...headings.map((heading) => Number(heading.tagName[1])),
  );
  return headings.filter((heading) => Number(heading.tagName[1]) === top);
}

export function DocumentPage({
  project,
  title,
  meta,
  writing,
  onResume,
  groups,
  notes,
  passages = [],
  margin,
  initialZoom = 1,
  children,
}: {
  /** The project the document belongs to, which the running header names. */
  project: string;
  title: string;
  /** The running header's right side: when it was filed, or how its writing stands. */
  meta: string;
  writing?: PageWriting | undefined;
  /** Starts the writing again where it stopped. */
  onResume?: (() => void) | undefined;
  /** The bar's own groups; the page puts its page count and zoom between the first and the last. */
  groups: readonly PaneBarGroup[];
  /** Short notes about the view, such as an older version being read, above the page. */
  notes?: ReactNode;
  /** Passages something is said about; each is underlined and given a place in the margin. */
  passages?: readonly MarginPassage[] | undefined;
  /** What sits in the right margin beside a passage, such as its comment. */
  margin?: ((passage: PassagePlace) => ReactNode) | undefined;
  initialZoom?: PageZoom;
  /** The document's body, drawn at the page's type scale. */
  children: ReactNode;
}) {
  const words = wording.documentViewer;
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const marginColumn = useRef<HTMLDivElement>(null);
  const marginItems = useRef<(HTMLDivElement | null)[]>([]);
  const [zoom, setZoom] = useState<PageZoom>(initialZoom);
  // The page's headings as the last measure found them, so scrolling need not look again.
  const headingsRef = useRef<HTMLElement[]>([]);
  const [sections, setSections] = useState<
    readonly { id: string; title: string }[]
  >([]);
  const [current, setCurrent] = useState<string | null>(null);
  // The section chosen in the contents holds while the view travels to it and once it is there,
  // until the person scrolls on: the sections passed on the way, or a short one landing below
  // the next, are not what they asked for. Undefined while the view follows the scroll.
  const chosen = useRef<string | null | undefined>(undefined);
  const jumping = useRef<number | null>(null);
  const [page, setPage] = useState({ current: 1, total: 1 });
  const [places, setPlaces] = useState<readonly PassagePlace[]>([]);
  const [roomy, setRoomy] = useState(true);

  const follow = useCallback(() => {
    const view = scroller.current;
    const paper = sheet.current;
    if (view === null || paper === null) return;
    const frame = view.getBoundingClientRect();
    const box = paper.getBoundingClientRect();
    const line = frame.top + frame.height * READING_LINE;
    // A page is A4 at the sheet's width, so a page count reads as it would on paper.
    const height = box.width * Math.SQRT2;
    const total = Math.max(1, Math.ceil(box.height / height - 0.01));
    const reading = Math.floor((line - box.top) / height) + 1;
    const current = Math.min(total, Math.max(1, reading));
    // Scrolling within a page changes nothing on screen, so it leaves the page as it was.
    setPage((was) =>
      was.current === current && was.total === total ? was : { current, total },
    );
    if (chosen.current !== undefined) {
      setCurrent(chosen.current);
      return;
    }
    // A jump puts a heading the scroll padding and its own scroll margin below the top.
    const headings = headingsRef.current;
    const top =
      frame.top + (parseFloat(getComputedStyle(view).scrollPaddingTop) || 0);
    // The sections share a heading level, so one heading's margin is all of theirs.
    const margin =
      headings[0] === undefined
        ? 0
        : parseFloat(getComputedStyle(headings[0]).scrollMarginTop) || 0;
    // A document that fits in the view has no end to reach; it is read from its top.
    const atEnd =
      view.scrollHeight > view.clientHeight + 2 &&
      view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
    setCurrent(
      sectionRead(
        headings.map((heading) => ({
          id: heading.id,
          top: heading.getBoundingClientRect().top - margin,
        })),
        top + LANDING_SLACK,
        atEnd ? frame.bottom : null,
      ),
    );
  }, []);

  // The person's own wheel, touch or key ends a jump at once, even while the view still moves.
  const scrollOn = () => {
    chosen.current = undefined;
    if (jumping.current !== null) window.clearTimeout(jumping.current);
    jumping.current = null;
  };

  // The view travels on its own after a jump; it has settled once it stops moving.
  const settleJump = () => {
    if (jumping.current !== null) window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => {
      jumping.current = null;
    }, JUMP_SETTLE_MS);
  };

  const passageKey = passages
    .map((passage) => `${passage.id}:${passage.state ?? ""}:${passage.quote}`)
    .join("\n");
  const measure = useCallback(() => {
    const paper = sheet.current;
    const column = marginColumn.current;
    if (paper === null) return;
    headingsRef.current = readSections(paper);
    const headings = headingsRef.current.map((heading) => ({
      id: heading.id,
      title: heading.textContent ?? "",
      top: heading.getBoundingClientRect().top,
    }));
    setSections((was) =>
      same(was, headings, (a, b) => a.id === b.id && a.title === b.title)
        ? was
        : headings.map(({ id, title }) => ({ id, title })),
    );
    const origin = column?.getBoundingClientRect().top ?? 0;
    const find = quoteFinder(paper);
    const found = passages.flatMap((passage) => {
      const range = find(passage.quote);
      if (range === null) return [];
      const top = range.getBoundingClientRect().top;
      const section =
        headings.findLast((heading) => heading.top <= top)?.id ?? null;
      return [{ range, place: { ...passage, top: top - origin, section } }];
    });
    paint(
      paper,
      found.map((hit) => ({
        highlight: HIGHLIGHTS[hit.place.state ?? "commented"],
        range: hit.range,
      })),
    );
    setPlaces((was) =>
      same(
        was,
        found.map((hit) => hit.place),
        (a, b) =>
          a.id === b.id &&
          a.state === b.state &&
          a.top === b.top &&
          a.section === b.section,
      )
        ? was
        : found.map((hit) => hit.place),
    );
    setRoomy(
      column === null || column.clientWidth - MARGIN_INSET >= CARD_WIDTH,
    );
    follow();
  }, [passageKey, follow]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(
    () => () => {
      if (jumping.current !== null) window.clearTimeout(jumping.current);
    },
    [],
  );

  // The body's words change as it is written or another version is read, and its lines move as
  // the page or the pane changes size; either moves the passages.
  useEffect(() => {
    const paper = sheet.current;
    const view = scroller.current;
    if (paper === null || view === null) return;
    const resized = new ResizeObserver(() => measure());
    resized.observe(paper);
    resized.observe(view);
    const rewritten = new MutationObserver(() => measure());
    rewritten.observe(paper, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      resized.disconnect();
      rewritten.disconnect();
      paint(paper, []);
    };
  }, [measure]);

  const inMargin = margin !== undefined && roomy;

  // Items too close to fit level with their passages stack below one another, in page order.
  // Every height is read before any top is written, so placing them costs one layout. An item
  // that grows, such as a comment opened to reply, moves the ones below it.
  useLayoutEffect(() => {
    if (!inMargin) return;
    const items = places.map((_, index) => marginItems.current[index] ?? null);
    const stack = () => {
      const heights = items.map((item) => item?.offsetHeight ?? 0);
      let floor = -Infinity;
      places.forEach((place, index) => {
        const top = Math.max(place.top - MARGIN_LEAD, floor);
        const item = items[index];
        if (item !== null && item !== undefined)
          item.style.top = `${String(top)}px`;
        floor = top + (heights[index] ?? 0) + MARGIN_GAP;
      });
    };
    stack();
    const resized = new ResizeObserver(stack);
    for (const item of items) if (item !== null) resized.observe(item);
    return () => resized.disconnect();
  }, [places, inMargin]);

  // The reader's scroll padding keeps a section clear of the bar; its scroll behaviour is smooth
  // unless the person asks for less motion.
  const open = (id: string | null) => {
    chosen.current = id;
    setCurrent(id);
    settleJump();
    if (id === null) scroller.current?.scrollTo({ top: 0 });
    else
      headingsRef.current
        .find((heading) => heading.id === id)
        ?.scrollIntoView({ block: "start" });
  };

  const zoomAt = ZOOMS.indexOf(zoom);
  const percent = Math.round(zoom * 100);
  const step = (by: number) => {
    const next = ZOOMS[zoomAt + by];
    if (next !== undefined) setZoom(next);
  };
  const pageGroups: readonly PaneBarGroup[] = [
    [
      {
        id: "page",
        label: words.page(page.current, page.total),
        text: words.page(page.current, page.total),
        note: true,
      },
    ],
    [
      {
        id: "zoom-out",
        label: words.zoomOut,
        icon: <Minus aria-hidden="true" />,
        disabled: zoomAt <= 0,
        onSelect: () => step(-1),
      },
      {
        id: "zoom",
        label: words.zoomReset(percent),
        text: words.zoom(percent),
        onSelect: () => setZoom(1),
      },
      {
        id: "zoom-in",
        label: words.zoomIn,
        icon: <Plus aria-hidden="true" />,
        disabled: zoomAt >= ZOOMS.length - 1,
        onSelect: () => step(1),
      },
    ],
  ];
  const leading = groups.slice(0, -1);
  const trailing = groups.slice(-1);
  const commented = new Set(places.map((place) => place.section));
  const contents: readonly DocumentSection[] = sections.map((section) => ({
    ...section,
    commented: commented.has(section.id),
  }));

  return (
    <div
      ref={scroller}
      className={styles.reader}
      style={
        {
          "--page-zoom": zoom,
          "--card-width": `${String(CARD_WIDTH)}px`,
        } as CSSProperties
      }
      data-slot="document-page"
      onScroll={() => {
        // Moving after a jump has settled is the person scrolling on.
        if (jumping.current === null) chosen.current = undefined;
        else settleJump();
        follow();
      }}
      onWheel={scrollOn}
      onTouchMove={scrollOn}
      onKeyDown={(event) => {
        if (SCROLL_KEYS.has(event.key)) scrollOn();
      }}
    >
      <PaneBar
        label={wording.documentBar}
        groups={[...leading, ...pageGroups, ...trailing]}
      />
      <div className={styles.layout}>
        <div className={styles.side}>
          <DocumentContents
            title={title}
            sections={contents}
            current={current}
            onOpen={open}
          />
        </div>
        <div className={styles.column}>
          {notes === undefined || notes === null ? null : (
            <div className={styles.notes}>{notes}</div>
          )}
          <article ref={sheet} className={styles.sheet} data-writing={writing}>
            <header className={styles.head}>
              <span>{project}</span>
              <span>{meta}</span>
            </header>
            <h1 className={styles.title}>{title}</h1>
            {children}
            {writing === "stopped" ? (
              <Fault onRetry={onResume}>{words.stopped}</Fault>
            ) : null}
          </article>
        </div>
        <div ref={marginColumn} className={styles.margin}>
          {margin === undefined || !roomy
            ? null
            : places.map((place, index) => (
                <div
                  key={place.id}
                  ref={(item) => {
                    marginItems.current[index] = item;
                  }}
                  className={styles.marginItem}
                  data-slot="document-margin-item"
                >
                  {margin(place)}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
