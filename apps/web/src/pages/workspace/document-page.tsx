/**
 * A written document read as a printed page: a sheet on the window's backdrop with the document's
 * title, Download and Share across from the title, and its body. The document's sections sit to
 * the left; the right margin holds whatever is placed beside a passage, level with it.
 */
import { Button, useDismissablePopover } from "@corbits/react-ui";
import { MessageSquare } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Fault } from "../../components.tsx";
import { wording } from "../../config.ts";
import {
  DocumentContents,
  type DocumentSection,
} from "./document-contents.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import styles from "./document-page.module.css";

/** Where a passage's comment stands, beyond being saved: selected while it is written. */
export type PassageState = "selected";

/** A passage something is said about, by the words it quotes from the page. */
export type MarginPassage = { id: string; quote: string; state?: PassageState };

/**
 * Where a passage sits: its top, from the top of the margin, and the section it is in. A passage
 * whose words are not on the page, such as one a later version rewrote, sits at the top of the
 * margin in no section.
 */
export type PassagePlace = MarginPassage & {
  top: number;
  section: string | null;
  found: boolean;
};

/** Where one end of the passage being written about sits, from the top left of the page's column. */
type PassageEnd = { x: number; y: number; height: number };

/** The two ends of the passage being written about, which its handles move. */
type PassageEnds = { id: string; start: PassageEnd; end: PassageEnd };

/** The text position under a point, by whichever of the two ways the browser offers. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const caret = document.caretPositionFromPoint(x, y);
    return caret === null
      ? null
      : { node: caret.offsetNode, offset: caret.offset };
  }
  const range = document.caretRangeFromPoint(x, y);
  return range === null
    ? null
    : { node: range.startContainer, offset: range.startOffset };
}

/** How the document's writing stands, while it is not yet filed whole. */
export type PageWriting = "live" | "stopped";

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
// A margin item is a card at most this wide; with less room than that beside the page, the cards
// leave the margin and open from their passages instead. The stylesheet takes the width from here.
const CARD_WIDTH = 280;
// Cards sit --space-8 clear of the page and want --space-6 clear of the pane's edge.
const MARGIN_INSET = 32 + 24;
// The underline sits below the line's box, so a press just under the words still reaches it.
const UNDERLINE_REACH = 8;
// Each state is its own highlight, named as the stylesheet paints it.
/**
 * A card opened from its passage closes on a press or focus elsewhere, except one being written:
 * its field decides, putting away a comment with nothing written and keeping one with words.
 */
function putAway<Card extends { place: PassagePlace }>(was: Card | null) {
  return was?.place.state === "selected" ? was : null;
}

const HIGHLIGHTS: Readonly<
  Record<PassageState | "commented" | "pointed", string>
> = {
  commented: "document-passage",
  selected: "document-passage-selected",
  pointed: "document-passage-pointed",
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
  title,
  writing,
  onResume,
  files,
  notes,
  passages = [],
  margin,
  onResize,
  onPassagePress,
  children,
}: {
  title: string;
  writing?: PageWriting | undefined;
  /** Starts the writing again where it stopped. */
  onResume?: (() => void) | undefined;
  /** Download and Share, for the file the document is given away as. */
  files: PaneBarGroup;
  /** Short notes about the view, such as an older version being read, above the page. */
  notes?: ReactNode;
  /** Passages something is said about; each is underlined and given a place in the margin. */
  passages?: readonly MarginPassage[] | undefined;
  /**
   * What sits in the right margin beside a passage, such as its comment. `pointed` is true while
   * the pointer is on the passage or on the item itself.
   */
  margin?: ((passage: PassagePlace, pointed: boolean) => ReactNode) | undefined;
  /** The passage being written about was dragged wider or narrower by one of its handles. */
  onResize?: ((id: string, range: Range) => void) | undefined;
  /** A passage's underline was pressed, to take up what is said about it. */
  onPassagePress?: ((id: string) => void) | undefined;
  /** The document's body, drawn at the page's type scale. */
  children: ReactNode;
}) {
  const words = wording.documentViewer;
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const marginColumn = useRef<HTMLDivElement>(null);
  const pageColumn = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState<PassageEnds | null>(null);
  const marginItems = useRef<(HTMLDivElement | null)[]>([]);
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
  const [places, setPlaces] = useState<readonly PassagePlace[]>([]);
  const [roomy, setRoomy] = useState(true);
  const ranges = useRef(new Map<string, Range>());
  // The passage the pointer is on, on the page or by its margin item: each shows the other.
  const [pointed, setPointed] = useState<string | null>(null);
  const pointedOwner = useRef({});
  const cardId = useId();
  const [card, setCard] = useState<{
    place: PassagePlace;
    line: DOMRect;
  } | null>(null);
  const { rootRef: cardRef, triggerRef: cardTrigger } = useDismissablePopover<
    HTMLDivElement,
    HTMLButtonElement
  >({
    open: card !== null,
    onOpenChange: (open) => {
      if (!open) setCard(putAway);
    },
  });

  const follow = useCallback(() => {
    const view = scroller.current;
    if (view === null) return;
    const frame = view.getBoundingClientRect();
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
    const found = passages
      .flatMap((passage) => {
        const range = find(passage.quote);
        if (range === null) return [];
        const top = range.getBoundingClientRect().top;
        const section =
          headings.findLast((heading) => heading.top <= top)?.id ?? null;
        return [
          {
            range,
            place: { ...passage, top: top - origin, section, found: true },
          },
        ];
      })
      .sort((a, b) => a.place.top - b.place.top);
    const missing = passages
      .filter((passage) => !found.some((hit) => hit.place.id === passage.id))
      .map((passage) => ({ ...passage, top: 0, section: null, found: false }));
    paint(
      paper,
      found.map((hit) => ({
        highlight: HIGHLIGHTS[hit.place.state ?? "commented"],
        range: hit.range,
      })),
    );
    ranges.current = new Map(found.map((hit) => [hit.place.id, hit.range]));
    // The passage being written about gets a handle at each end, at its first and last line.
    const writing = found.find((hit) => hit.place.state === "selected");
    const lines = [...(writing?.range.getClientRects() ?? [])].filter(
      (line) => line.width > 0,
    );
    const first = lines[0];
    const last = lines.at(-1);
    const frame = pageColumn.current?.getBoundingClientRect();
    const next =
      writing === undefined ||
      first === undefined ||
      last === undefined ||
      frame === undefined
        ? null
        : {
            id: writing.place.id,
            start: {
              x: first.left - frame.left,
              y: first.top - frame.top,
              height: first.height,
            },
            end: {
              x: last.right - frame.left,
              y: last.top - frame.top,
              height: last.height,
            },
          };
    setEnds((was) =>
      was !== null &&
      next !== null &&
      was.id === next.id &&
      (["start", "end"] as const).every(
        (side) =>
          was[side].x === next[side].x &&
          was[side].y === next[side].y &&
          was[side].height === next[side].height,
      )
        ? was
        : next,
    );
    // Passages not on the page head the margin, above those level with their lines.
    const now = [...missing, ...found.map((hit) => hit.place)];
    setPlaces((was) =>
      same(
        was,
        now,
        (a, b) =>
          a.id === b.id &&
          a.state === b.state &&
          a.top === b.top &&
          a.section === b.section &&
          a.found === b.found,
      )
        ? was
        : now,
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

  // A passage pointed at from its margin item is tinted; one being written is tinted already.
  useEffect(() => {
    const owner = pointedOwner.current;
    const place = places.find((item) => item.id === pointed);
    const range = ranges.current.get(pointed ?? "");
    paint(
      owner,
      place === undefined || place.state === "selected" || range === undefined
        ? []
        : [{ highlight: HIGHLIGHTS.pointed, range }],
    );
    return () => paint(owner, []);
  }, [pointed, places]);

  // A card opened from its passage sits under the line, or above it when the view ends first.
  useLayoutEffect(() => {
    const box = cardRef.current;
    if (card === null || box === null) return;
    const below = card.line.bottom + MARGIN_GAP;
    const fitsBelow =
      below + box.offsetHeight <= window.innerHeight - MARGIN_GAP;
    box.style.top = `${String(fitsBelow ? below : card.line.top - MARGIN_GAP - box.offsetHeight)}px`;
    box.dataset.side = fitsBelow ? "below" : "above";
    box.style.left = `${String(Math.max(MARGIN_GAP, Math.min(card.line.left, window.innerWidth - box.offsetWidth - MARGIN_GAP)))}px`;
    // Opened from the keyboard, the card takes focus so Escape can hand it back, and appears at
    // once: a key press is answered without a flourish.
    if (cardTrigger.current === null) delete box.dataset.keys;
    else {
      box.dataset.keys = "";
      box.focus({ preventScroll: true });
    }
  }, [card, cardRef, cardTrigger]);

  // A handle drags its end of the passage to the text under the pointer, measured from the line it
  // took hold of, so the words move with the finger rather than with the knob above or below them.
  const resizeFrom = (side: "start" | "end", event: PointerEvent) => {
    const column = pageColumn.current;
    const paper = sheet.current;
    const range = ends === null ? undefined : ranges.current.get(ends.id);
    if (
      ends === null ||
      onResize === undefined ||
      column === null ||
      paper === null ||
      range === undefined
    )
      return;
    event.preventDefault();
    const { id } = ends;
    const held =
      side === "start"
        ? { node: range.endContainer, offset: range.endOffset }
        : { node: range.startContainer, offset: range.startOffset };
    const line = ends[side];
    const lift =
      event.clientY -
      (column.getBoundingClientRect().top + line.y + line.height / 2);
    column.dataset.resizing = "";
    const move = (moved: globalThis.PointerEvent) => {
      const caret = caretAt(moved.clientX, moved.clientY - lift);
      if (caret === null || !paper.contains(caret.node)) return;
      const next = document.createRange();
      next.setStart(held.node, held.offset);
      if (next.comparePoint(caret.node, caret.offset) < 0)
        next.setStart(caret.node, caret.offset);
      else next.setEnd(caret.node, caret.offset);
      if (!next.collapsed) onResize(id, next);
    };
    const stop = () => {
      delete column.dataset.resizing;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const narrow = margin !== undefined && !roomy;
  const inMargin = margin !== undefined && !narrow;

  // Without room beside the page, a passage just selected to write about opens its card from its
  // line at once, since there is no margin for it to appear in. Each opens once, so closing it
  // leaves it closed until its underline is pressed.
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    // A card whose passage is gone, such as one just saved under a new name, closes with it.
    setCard((was) =>
      was === null || places.some((place) => place.id === was.place.id)
        ? was
        : null,
    );
    const writing = places.find((place) => place.state === "selected");
    if (!narrow || writing === undefined) {
      opened.current = writing?.id ?? null;
      return;
    }
    if (opened.current === writing.id) return;
    opened.current = writing.id;
    const line = ranges.current.get(writing.id)?.getClientRects()[0];
    if (line === undefined) return;
    cardTrigger.current = null;
    setCard({ place: writing, line });
  }, [places, narrow, cardTrigger]);

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
        const top = Math.max(place.found ? place.top - MARGIN_LEAD : 0, floor);
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

  /** The passage under a point on the page, by the line of it that was pressed. */
  const passageAt = (x: number, y: number) => {
    for (const place of places) {
      const lines = ranges.current.get(place.id)?.getClientRects() ?? [];
      const line = [...lines].find(
        (rect) =>
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom + UNDERLINE_REACH,
      );
      if (line !== undefined) return { place, line };
    }
    return null;
  };

  const pressable = narrow || onPassagePress !== undefined;

  // A passage's underline takes up its comment; with the margin too narrow for its cards, it opens
  // the card from the line as well.
  const openFromMark = (event: MouseEvent) => {
    if (!pressable || window.getSelection()?.isCollapsed === false) return;
    const hit = passageAt(event.clientX, event.clientY);
    if (hit === null) return;
    // The comment takes this press; quoting the passage into a message is not offered as well.
    event.stopPropagation();
    if (hit.place.state !== "selected") onPassagePress?.(hit.place.id);
    if (!narrow) return;
    cardTrigger.current = null;
    setCard(hit);
  };

  const pointAtMark = (event: MouseEvent<HTMLElement>) => {
    const hit = passageAt(event.clientX, event.clientY);
    setPointed(hit?.place.id ?? null);
    event.currentTarget.toggleAttribute(
      "data-pointing",
      pressable && hit !== null,
    );
  };

  const openFromKeys = (place: PassagePlace, button: HTMLButtonElement) => {
    // A passage not on the page opens its card from its mark.
    const line =
      ranges.current.get(place.id)?.getClientRects()[0] ??
      button.getBoundingClientRect();
    cardTrigger.current = button;
    setCard({ place, line });
  };

  // The reader's scroll behaviour is smooth unless the person asks for less motion.
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

  const commented = new Set(places.map((place) => place.section));
  const contents: readonly DocumentSection[] = sections.map((section) => ({
    ...section,
    commented: commented.has(section.id),
  }));

  return (
    <div
      ref={scroller}
      className={styles.reader}
      style={{ "--card-width": `${String(CARD_WIDTH)}px` } as CSSProperties}
      data-slot="document-page"
      onScroll={() => {
        // Moving after a jump has settled is the person scrolling on.
        if (jumping.current === null) chosen.current = undefined;
        else settleJump();
        follow();
        // A comment being written rides along with its line rather than closing on its words.
        setCard((was) => {
          if (was?.place.state !== "selected") return null;
          const line = ranges.current.get(was.place.id)?.getClientRects()[0];
          return line === undefined ? was : { ...was, line };
        });
      }}
      onWheel={scrollOn}
      onTouchMove={scrollOn}
      onKeyDown={(event) => {
        if (SCROLL_KEYS.has(event.key)) scrollOn();
      }}
    >
      <div className={styles.layout}>
        <div className={styles.side}>
          <FileActions files={files} />
          <DocumentContents
            title={title}
            sections={contents}
            current={current}
            onOpen={open}
          />
        </div>
        <div ref={pageColumn} className={styles.column}>
          {notes === undefined || notes === null ? null : (
            <div className={styles.notes}>{notes}</div>
          )}
          <article
            ref={sheet}
            className={styles.sheet}
            data-writing={writing}
            onClickCapture={openFromMark}
            onPointerMove={pointAtMark}
            onPointerLeave={() => setPointed(null)}
          >
            <h1 className={styles.title}>{title}</h1>
            {children}
            {writing === "stopped" ? (
              <Fault onRetry={onResume}>{words.stopped}</Fault>
            ) : null}
          </article>
          {/* Pointer only, as a text selection's own handles are: the keyboard selects again. */}
          {ends === null || onResize === undefined
            ? null
            : (["start", "end"] as const).map((side) => (
                <span
                  key={side}
                  className={styles.handle}
                  data-side={side}
                  data-slot="passage-handle"
                  aria-hidden="true"
                  style={{
                    left: ends[side].x,
                    top: ends[side].y,
                    height: ends[side].height,
                  }}
                  onPointerDown={(event) => resizeFrom(side, event)}
                />
              ))}
          {narrow
            ? places.map((place) => (
                <Button
                  key={place.id}
                  variant="ghost"
                  size="icon"
                  className={styles.mark}
                  style={{ top: place.top }}
                  aria-label={words.passageNote(place.quote)}
                  aria-haspopup="dialog"
                  aria-expanded={card?.place.id === place.id}
                  aria-controls={
                    card?.place.id === place.id ? cardId : undefined
                  }
                  onClick={(event) => openFromKeys(place, event.currentTarget)}
                >
                  <MessageSquare aria-hidden="true" />
                </Button>
              ))
            : null}
        </div>
        <div ref={marginColumn} className={styles.margin}>
          {margin === undefined || narrow
            ? null
            : places.map((place, index) => (
                <div
                  key={place.id}
                  ref={(item) => {
                    marginItems.current[index] = item;
                  }}
                  className={styles.marginItem}
                  data-slot="document-margin-item"
                  onPointerEnter={() => setPointed(place.id)}
                  onPointerLeave={() => setPointed(null)}
                >
                  {margin(place, pointed === place.id)}
                </div>
              ))}
        </div>
      </div>
      {card === null || margin === undefined
        ? null
        : createPortal(
            <div
              ref={cardRef}
              className={styles.card}
              style={
                { "--card-width": `${String(CARD_WIDTH)}px` } as CSSProperties
              }
              id={cardId}
              data-slot="document-margin-card"
              role="dialog"
              aria-label={words.passageNote(card.place.quote)}
              tabIndex={-1}
              onBlur={(event) => {
                if (
                  event.relatedTarget !== null &&
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setCard(putAway);
              }}
            >
              {margin(card.place, false)}
            </div>,
            document.body,
          )}
    </div>
  );
}

/** Download and Share, each an outlined button named in words beside its icon. */
function FileActions({ files }: { files: PaneBarGroup }) {
  if (files.length === 0) return null;
  return (
    <div
      className={styles.files}
      data-slot="document-files"
      role="group"
      aria-label={wording.documentViewer.file}
    >
      {files.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant="outline"
          size="sm"
          className={styles.file}
          title={action.label}
          aria-label={action.label}
          disabled={action.disabled}
          onClick={action.onSelect}
          {...(action.onPrepare === undefined
            ? {}
            : { onPointerEnter: action.onPrepare, onFocus: action.onPrepare })}
        >
          {action.icon}
          <span>{action.text}</span>
        </Button>
      ))}
    </div>
  );
}
