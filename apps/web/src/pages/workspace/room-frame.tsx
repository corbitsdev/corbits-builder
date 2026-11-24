/**
 * The room's layout: a main pane across the whole window, with a zone standing over each of its
 * margins. The left holds the sidebar, its title in the window's top left corner; the right holds
 * what a plugin shows. Whatever the main pane shows is its one scroller, edge to edge, so the
 * scrollbar is at the window's edge, and holds its content to the column in the window's middle, so
 * neither side ever moves it. On a window too narrow for them beside the column, the sides open
 * over the page.
 */
import type { ReactNode } from "react";
import styles from "./room-frame.module.css";

/**
 * What the right zone holds. Empty keeps its margin, so the column stays as it is; hidden gives
 * the margin to the column, which grows wider.
 */
export type RoomFrameSide =
  | { state: "showing"; content: ReactNode }
  | { state: "empty" }
  | { state: "hidden" };

export type RoomFrameProps = {
  /** The sidebar, open or closed, its title in the window's top left corner. */
  sidebar: ReactNode;
  side: RoomFrameSide;
  /** The main pane's view, which scrolls itself and keeps its content to `--frame-column`. */
  children: ReactNode;
};

export function RoomFrame({ sidebar, side, children }: RoomFrameProps) {
  return (
    <div className={styles.frame} data-slot="room-frame" data-side={side.state}>
      <div className={styles.main}>{children}</div>
      <div className={styles.left}>{sidebar}</div>
      {side.state === "showing" ? (
        <aside className={styles.right}>{side.content}</aside>
      ) : null}
    </div>
  );
}
