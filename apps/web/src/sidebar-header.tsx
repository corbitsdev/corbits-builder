/**
 * The sidebar's title row: the mark, whose menu leads back to the projects or to Preferences, the name,
 * which opens a menu of its own where there is one, and the toggle that opens and closes the
 * sidebar, from anywhere with the shortcut too.
 */
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { wording } from "./config.ts";
import { Mark, MenuPanel } from "./components.jsx";
import styles from "./sidebar-header.module.css";

const words = wording.projectShell;

// The platform's own modifier, so the shortcut, its announced keys and its title agree.
const mac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = mac
  ? { key: "Meta+Backslash", words: words.shortcut.mac }
  : { key: "Control+Backslash", words: words.shortcut.other };

/** Where a header menu opens, from its trigger: below it, by this much. */
export type MenuPlacement = { sideOffset: number };

/** A menu opened from the name, given the button that opens it and where it opens. */
export type TitleMenu = (
  trigger: ReactElement,
  placement: MenuPlacement,
) => ReactNode;

const MENU_GAP = 8;

/** Where the mark's menu leads, in a project and outside one. */
export type MarkWays = {
  /** Back to the projects, on the home page. */
  onHome: () => void;
  onPreferences: () => void;
};

export type SidebarHeaderProps = MarkWays & {
  title: string;
  /** Absent, the name is only shown. */
  titleMenu?: TitleMenu | undefined;
  open: boolean;
  /** The id of what the toggle opens and closes. */
  controls: string;
  onToggle: () => void;
};

/**
 * The row marks itself while the last open or close came from the shortcut, which is pressed too
 * often to wait on, so whatever holds it can open and close at once.
 */
export function SidebarHeader({
  title,
  titleMenu,
  open,
  controls,
  onToggle,
  onHome,
  onPreferences,
}: SidebarHeaderProps) {
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
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  // Each menu drops from under its own button, so the pointer has nowhere to travel, and both
  // tops sit level under this row though the buttons differ in height. A menu positions itself
  // from the button that opens it, so as either is pressed, its distance from the row's foot
  // becomes the one placement both menus read.
  const headRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement>({
    sideOffset: MENU_GAP,
  });
  const placeFrom = (target: EventTarget) => {
    const trigger = target instanceof Element ? target.closest("button") : null;
    const row = headRef.current?.getBoundingClientRect();
    if (trigger === null || row === undefined) return;
    const at = trigger.getBoundingClientRect();
    setPlacement({
      sideOffset: Math.round(row.bottom - at.bottom + MENU_GAP),
    });
  };
  const toggleWords = open ? words.closeSidebar : words.openSidebar;
  return (
    <div
      ref={headRef}
      className={styles.head}
      data-open={open ? "" : undefined}
      data-instant={byKey ? "" : undefined}
      onPointerDownCapture={(event) => placeFrom(event.target)}
      onKeyDownCapture={(event) => placeFrom(event.target)}
    >
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className={styles.mark} aria-label={words.menu}>
            <Mark size={28} />
          </button>
        </MenuTrigger>
        <MenuPanel side="bottom" align="start" {...placement}>
          <MenuItem onSelect={onHome}>{words.backToProjects}</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onPreferences}>
            {wording.settings.tab.preferences}
          </MenuItem>
        </MenuPanel>
      </Menu>
      {titleMenu === undefined ? (
        <span className={styles.project}>{title}</span>
      ) : (
        titleMenu(
          <button type="button" className={styles.project}>
            {title}
          </button>,
          placement,
        )
      )}
      <button
        type="button"
        className={styles.toggle}
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
      </button>
    </div>
  );
}
