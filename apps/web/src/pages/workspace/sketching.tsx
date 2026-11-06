/**
 * An app taking shape, drawn as a sketch with a few short lines under it: a concept's designer
 * drafting it, or the Builder writing the first app. It moves only while that work is under way.
 */
import type { CSSProperties, ReactNode } from "react";
import { clock, useElapsedMs } from "./elapsed.tsx";
import styles from "./sketching.module.css";

/** An app's frame drawn as placeholder bars; it pulses unless its container is still. */
const AppSketch = () => (
  <div className={styles.sketch} aria-hidden="true">
    <span className={styles.sketchBar} />
    <span className={styles.sketchTitle} />
    <span className={styles.sketchLine} />
    <span className={styles.sketchLineShort} />
    <span className={styles.sketchCards}>
      <span />
      <span />
      <span />
    </span>
  </div>
);

export function Sketching({
  working,
  style,
  children,
}: {
  working: boolean;
  /** The concept's own look, as the sketch's custom properties. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.sketching}
      data-slot="sketching"
      data-state={working ? "working" : "still"}
      style={style}
      role="status"
    >
      <AppSketch />
      {children}
    </div>
  );
}

export const SketchingLead = ({ children }: { children: ReactNode }) => (
  <p className={styles.lead}>{children}</p>
);

export const SketchingNote = ({ children }: { children: ReactNode }) => (
  <p className={styles.note}>{children}</p>
);

/**
 * The time the work has taken so far, ticking within the note; mounted only while it is under
 * way. `label` words the running clock, such as "1:05 elapsed".
 */
export function SketchingClock({
  since,
  label,
}: {
  since: string;
  label: (clock: string) => string;
}) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className={styles.clock} role="timer" aria-live="off">
      {label(clock(seconds))}
    </span>
  );
}
