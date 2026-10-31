import { useCallback, useRef, type WheelEvent } from "react";

// Within this many pixels of an end, the strip counts as scrolled to it.
const END_SLACK_PX = 2;

function markEnds(list: HTMLElement) {
  const more = list.scrollWidth - list.clientWidth;
  list.toggleAttribute("data-more-start", list.scrollLeft > END_SLACK_PX);
  list.toggleAttribute("data-more-end", list.scrollLeft < more - END_SLACK_PX);
}

/**
 * A tab row that scrolls sideways: it marks which ends hide tabs, so the row can fade there, and a
 * vertical wheel scrolls it, since a mouse has no sideways wheel.
 */
export function useTabStrip() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const observer = useRef<{
    resize: ResizeObserver;
    tabs: MutationObserver;
  } | null>(null);
  const ref = useCallback((list: HTMLDivElement | null) => {
    observer.current?.resize.disconnect();
    observer.current?.tabs.disconnect();
    observer.current = null;
    listRef.current = list;
    if (list === null) return;
    const mark = () => markEnds(list);
    const resize = new ResizeObserver(mark);
    const tabs = new MutationObserver(mark);
    resize.observe(list);
    // A selected tab widens to its full label, so a change of selection can move the ends too.
    tabs.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ["data-state"],
    });
    observer.current = { resize, tabs };
    mark();
  }, []);
  const onScroll = useCallback(() => {
    if (listRef.current !== null) markEnds(listRef.current);
  }, []);
  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
      event.currentTarget.scrollLeft += event.deltaY;
  }, []);
  return { ref, onScroll, onWheel };
}
