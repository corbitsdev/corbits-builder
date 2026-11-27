/**
 * The sidebar, which knows nothing of what it holds: a stack of small cards, the title on top, then
 * the cards the page passes, with the control that expands and collapses it at the foot. Collapsed,
 * it holds the title and the cards that always show; expanded, the rest come in under them. Where
 * the window is narrow it is a drawer over the page, put away on Escape or a press beside it.
 */
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { wording } from "./config.ts";
import styles from "./sidebar-shell.module.css";

const words = wording.projectShell;

// The platform's own modifier, so the shortcut, its announced keys and its title agree.
const mac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = mac
  ? { key: "Meta+Backslash", words: words.shortcut.mac }
  : { key: "Control+Backslash", words: words.shortcut.other };

/**
 * One card of the sidebar's stack, sized to what it holds. One that scrolls gives way when the
 * stack is taller than the window and scrolls inside itself; the rest keep their size.
 */
export function SidebarSurface({
  scrolls = false,
  children,
}: {
  scrolls?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.surface}
      data-slot="sidebar-surface"
      data-scrolls={scrolls ? "" : undefined}
    >
      {children}
    </div>
  );
}

export function SidebarShell({
  label,
  open,
  drawer,
  header,
  surfaces = null,
  more = null,
  onToggle,
}: {
  /** What a screen reader calls the sidebar. */
  label: string;
  /** Expanded; collapsed, only the header and `surfaces` show. */
  open: boolean;
  /** The window is too narrow for the sidebar beside the page, so the open sidebar lies over it. */
  drawer: boolean;
  /** What the title card holds. */
  header: ReactNode;
  /** The cards under the title, expanded or collapsed; a collapsed drawer leaves them out. */
  surfaces?: ReactNode;
  /** The cards under those, shown only while expanded. */
  more?: ReactNode;
  /** Expands or collapses the sidebar, and puts the open drawer away. */
  onToggle: () => void;
}) {
  const moreId = `sidebar-more-${useId()}`;
  // An open drawer lies over the page, so Escape or a press on the page puts it away, as a dialog's
  // would. Escape is heard before the page's own, which would otherwise close the view beneath.
  const rootRef = useRef<HTMLElement>(null);
  const putAway = useEffectEvent(onToggle);
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
  // One root expanded or collapsed, so the toggle keeps focus and the cards above it stay where
  // they are. The stack lets presses through its gaps, so they land on the page.
  return (
    <aside
      ref={rootRef}
      className={styles.sidebar}
      data-slot="project-sidebar"
      data-open={open ? "" : undefined}
      data-drawer={drawer ? "" : undefined}
      aria-label={label}
    >
      <div className={styles.stack}>
        <SidebarSurface>{header}</SidebarSurface>
        {surfaces === null ? null : (
          <div className={styles.kept}>{surfaces}</div>
        )}
        <div id={moreId} className={styles.more}>
          {more}
        </div>
        <SidebarToggle open={open} controls={moreId} onToggle={onToggle} />
      </div>
    </aside>
  );
}

/**
 * The quiet control at the stack's foot, from anywhere with the shortcut too. It marks itself while
 * the last expand or collapse came from the shortcut, which is pressed too often to wait on, so the
 * sidebar can change at once.
 */
function SidebarToggle({
  open,
  controls,
  onToggle,
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const [byKey, setByKey] = useState(false);
  const toggleByKey = useEffectEvent(() => {
    setByKey(true);
    onToggle();
  });
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "\\" || !(mac ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      toggleByKey();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const Icon = open ? ChevronUp : ChevronDown;
  const toggleWords = open ? words.closeSidebar : words.openSidebar;
  return (
    <button
      type="button"
      className={styles.toggle}
      data-instant={byKey ? "" : undefined}
      aria-label={toggleWords}
      aria-expanded={open}
      aria-controls={controls}
      aria-keyshortcuts={shortcut.key}
      title={`${toggleWords} (${shortcut.words})`}
      onClick={() => {
        setByKey(false);
        onToggle();
      }}
    >
      <Icon aria-hidden="true" />
      <span aria-hidden="true">
        {open ? words.sidebarLess : words.sidebarMore}
      </span>
    </button>
  );
}
