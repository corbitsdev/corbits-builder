import type { ReactNode } from "react";
import styles from "./composer.module.css";

/**
 * The frame every composer sits in, on the home page and in a project: notes
 * above the box, the box beneath. While the specialist works, a ring sweeps
 * the box's border.
 */
export function Composer({
  variant = "pane",
  working = false,
  notes,
  children,
}: {
  /** In a pane it keeps its own inset; on a page the page gives it a gutter and its words the whole first line. */
  variant?: "pane" | "page";
  working?: boolean;
  /** Faults and notices about the message, above the box; they give way before the box does. */
  notes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.composer}
      data-slot="composer"
      data-variant={variant}
      data-working={working ? "" : undefined}
    >
      {notes === undefined ? null : (
        <div className={styles.notes} data-slot="composer-notes">
          {notes}
        </div>
      )}
      {children}
    </div>
  );
}
