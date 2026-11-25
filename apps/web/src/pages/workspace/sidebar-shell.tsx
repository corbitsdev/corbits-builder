/**
 * The sidebar's card, which knows nothing of what it holds: a header, then a top and a bottom
 * section, as the page passes them. Closed, the card holds the header and the top; open, it grows
 * to the window's height around them and shows the bottom too. Where the window is narrow it is a
 * drawer over the page, put away on Escape or a press beside it.
 */
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import styles from "./sidebar-shell.module.css";

export function SidebarShell({
  label,
  open,
  drawer,
  bottomId,
  header,
  top = null,
  bottom = null,
  onPutAway,
}: {
  /** What a screen reader calls the sidebar. */
  label: string;
  open: boolean;
  /** The window is too narrow for the sidebar beside the page, so the open sidebar lies over it. */
  drawer: boolean;
  /** The bottom section's id, which the header's toggle opens and closes. */
  bottomId: string;
  header: ReactNode;
  /** What stays under the header, open or closed, without moving as the card grows. */
  top?: ReactNode;
  /** What the card holds only while open. */
  bottom?: ReactNode;
  /** Puts the open drawer away. */
  onPutAway: () => void;
}) {
  // An open drawer lies over the page, so Escape or a press on the page puts it away, as a dialog's
  // would. Escape is heard before the page's own, which would otherwise close the view beneath.
  const rootRef = useRef<HTMLElement>(null);
  const putAway = useEffectEvent(onPutAway);
  useEffect(() => {
    if (!drawer || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      putAway();
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // A menu opened from the sidebar is drawn outside it but belongs to it.
      if (rootRef.current?.contains(target) || target.closest('[role="menu"]'))
        return;
      putAway();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [drawer, open]);
  // One root open or closed, so the toggle keeps focus and the top stays as it is as the card
  // opens and closes.
  return (
    <aside
      ref={rootRef}
      className={styles.sidebar}
      data-slot="project-sidebar"
      data-open={open ? "" : undefined}
      data-drawer={drawer ? "" : undefined}
      aria-label={label}
    >
      <div className={styles.card}>
        {header}
        <div className={styles.sections}>
          {top === null ? null : <div className={styles.top}>{top}</div>}
          <div id={bottomId} className={styles.bottom}>
            {bottom}
          </div>
        </div>
      </div>
    </aside>
  );
}
