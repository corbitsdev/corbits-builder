/**
 * The room's layout: the left zone, which keeps the sidebar's width beside the page whether the
 * sidebar is open or not, so opening it moves nothing, and the main pane in the rest of the window.
 * Whatever the main pane shows is its one scroller, edge to edge, so the scrollbar is at the
 * window's edge, and centres what it holds in the pane. On a window too narrow for the sidebar
 * beside the page, the sidebar is a drawer over it and the pane takes the whole window.
 */
import type { ReactNode } from "react";
import styles from "./room-frame.module.css";

export type RoomFrameProps = {
  /** The sidebar, open or closed, its title in the window's top left corner. */
  sidebar: ReactNode;
  /** The main pane's view, which scrolls itself and centres what it holds. */
  children: ReactNode;
};

export function RoomFrame({ sidebar, children }: RoomFrameProps) {
  return (
    <div className={styles.frame} data-slot="room-frame">
      <div className={styles.main}>{children}</div>
      <div className={styles.left}>{sidebar}</div>
    </div>
  );
}
