import type { ReactNode } from "react";
import styles from "./composer.module.css";

/**
 * The frame every composer sits in, on the home page and in a project: notes above the box, the
 * box beneath. Whatever waits on the person sits inside the box on top of the typing row, as the
 * card the conversation would show it in; the box is its frame. Otherwise the box stays one line
 * tall: what is happening is the status pill's to say, never a row in here.
 */
export function Composer({
  variant = "pane",
  bare = false,
  notes,
  panel,
  around,
  children,
}: {
  /** In a pane it keeps its own inset; on a page the page gives it a gutter. */
  variant?: "pane" | "page";
  /**
   * Only the typing row shows. The panel stays mounted so what waits keeps its buttons in the row;
   * the page beside it shows the rest.
   */
  bare?: boolean;
  /** Faults and notices about the message, above the box; they give way before the box does. */
  notes?: ReactNode;
  /** What waits on the person, such as a question card or a plugin's screen, above the typing row. */
  panel?: ReactNode | undefined;
  /** What grows around the box without moving it, such as the chat sheet; it is handed the box. */
  around?: ((box: ReactNode) => ReactNode) | undefined;
  children: ReactNode;
}) {
  const box = (
    <div className={styles.box} data-slot="composer-box">
      {panel === undefined ? null : (
        <div className={styles.panel} data-slot="composer-panel" hidden={bare}>
          {panel}
        </div>
      )}
      {children}
    </div>
  );
  return (
    <div
      className={styles.composer}
      data-slot="composer"
      data-variant={variant}
    >
      {notes === undefined ? null : (
        <div className={styles.notes} data-slot="composer-notes">
          {notes}
        </div>
      )}
      {around === undefined ? box : around(box)}
    </div>
  );
}
