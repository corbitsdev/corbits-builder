/**
 * The room's layout: one column centred on the window, with a zone in each margin beside it. The
 * left holds the project's title, or the whole sidebar under it; the right holds what a plugin
 * shows. Neither side ever moves the column: beside it they stand in its margins, and on a window
 * too narrow for them they open over the page. The window scrolls the page, with the prompt box
 * held at the column's foot.
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
  /** The project's title, in the window's top left corner whether the sidebar is open or not. */
  title: ReactNode;
  /** The sidebar's rows, under the title while it is open. */
  sidebar: ReactNode;
  sidebarOpen: boolean;
  side: RoomFrameSide;
  /** The prompt box, held at the foot of the column as the page scrolls under it. */
  prompt: ReactNode;
  /** The page in the column. */
  children: ReactNode;
};

export function RoomFrame({
  title,
  sidebar,
  sidebarOpen,
  side,
  prompt,
  children,
}: RoomFrameProps) {
  return (
    <div
      className={styles.frame}
      data-slot="room-frame"
      data-sidebar={sidebarOpen ? "open" : "closed"}
      data-side={side.state}
    >
      <div className={styles.column}>
        <div className={styles.page}>{children}</div>
        <div className={styles.prompt}>{prompt}</div>
      </div>
      <aside className={styles.left}>
        <div className={styles.title}>{title}</div>
        {sidebarOpen ? <div className={styles.sidebar}>{sidebar}</div> : null}
      </aside>
      {side.state === "showing" ? (
        <aside className={styles.right}>{side.content}</aside>
      ) : null}
    </div>
  );
}
