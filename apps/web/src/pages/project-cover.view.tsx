/**
 * A project tile's cover: the first page of the project's design as a still
 * picture, or its pattern while there is no mockup to show.
 */
import { useEffect, useEffectEvent, useRef, type CSSProperties } from "react";
import { GuiFrame } from "./workspace/gui-frame.tsx";
import styles from "./project-cover.module.css";

// A tile a screen's height away says it is near, so its mockup is there by the time it scrolls in.
const AHEAD = "100%";

/** Calls `onNear` once the element has come within a screen of the viewport. */
function useNearView(
  ref: React.RefObject<HTMLElement | null>,
  onNear: () => void,
): void {
  const near = useEffectEvent(onNear);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      near();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        near();
      },
      { rootMargin: AHEAD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
}

export type ProjectCoverViewProps = {
  pattern: string;
  style: CSSProperties;
  /** The page to show as a still picture; null shows the pattern only. */
  mockup: string | null;
  /** The cover has come within a screen of the viewport, which is when its mockup is worth reading. */
  onNear: () => void;
};

export function ProjectCoverView({
  pattern,
  style,
  mockup,
  onNear,
}: ProjectCoverViewProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useNearView(ref, onNear);
  return (
    // A still picture: inert, so it neither takes focus nor eats the click that opens the project.
    <span
      ref={ref}
      className={styles.cover}
      data-slot="project-cover"
      data-pattern={pattern}
      data-mockup={mockup === null ? undefined : ""}
      style={style}
      aria-hidden="true"
      inert
    >
      {mockup === null ? null : <GuiFrame html={mockup} scripts thumbnail />}
    </span>
  );
}
