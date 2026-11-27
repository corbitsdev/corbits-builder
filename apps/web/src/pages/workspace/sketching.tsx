/**
 * The first app taking shape, drawn as a sketch with a few short lines under it. It moves only
 * while the Builder is writing it.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { clock, useElapsedMs } from "./elapsed.ts";
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

/**
 * Told while a sketch at work is on the page, so whatever else would say the same work is under
 * way, such as the pill above the prompt box, can leave that to it. The call returns its undoing.
 */
export const SketchingShown = createContext<(() => () => void) | null>(null);

export function Sketching({
  working,
  children,
}: {
  working: boolean;
  children: ReactNode;
}) {
  const shown = useContext(SketchingShown);
  useEffect(
    () => (working && shown !== null ? shown() : undefined),
    [working, shown],
  );
  return (
    <div
      className={styles.sketching}
      data-slot="sketching"
      data-state={working ? "working" : "still"}
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
