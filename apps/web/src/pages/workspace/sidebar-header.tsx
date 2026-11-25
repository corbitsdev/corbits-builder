/**
 * The sidebar's title row: the mark, whose menu leads back to the projects or to Settings, the name,
 * which opens a menu of its own where there is one, and the toggle that opens and closes the
 * sidebar, from anywhere with the shortcut too.
 */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { wording } from "../../config.ts";
import { Mark } from "../../components.jsx";
import menuStyles from "../project-menu.module.css";
import styles from "./sidebar-header.module.css";

const words = wording.projectShell;

// The platform's own modifier, so the shortcut, its announced keys and its title agree.
const mac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = mac
  ? { key: "Meta+Backslash", words: words.shortcut.mac }
  : { key: "Control+Backslash", words: words.shortcut.other };

/** Where a header menu opens, from its trigger: to the right of it and up from its top. */
export type MenuPlacement = { sideOffset: number; alignOffset: number };

/** A menu opened from the name, given the button that opens it and where it opens. */
export type TitleMenu = (
  trigger: ReactElement,
  placement: MenuPlacement,
) => ReactNode;

const MENU_GAP = 8;
const NEAR: MenuPlacement = { sideOffset: MENU_GAP, alignOffset: 0 };
const samePlace = (a: MenuPlacement, b: MenuPlacement) =>
  a.sideOffset === b.sideOffset && a.alignOffset === b.alignOffset;

/** Where the mark's menu leads, in a project and outside one. */
export type MarkWays = {
  /** Back to the projects, on the home page. */
  onHome: () => void;
  onSettings: () => void;
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
  onSettings,
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
  // The menus open beside the card, over the page, their tops level with this row, so the title,
  // the toggle and the plan stay in sight. A menu anchors to its trigger, so each is placed by how
  // far its trigger stands from this row's right edge, which is the card's, and its top.
  const headRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const [beside, setBeside] = useState({ mark: NEAR, name: NEAR });
  useLayoutEffect(() => {
    const head = headRef.current?.getBoundingClientRect();
    if (head === undefined) return;
    const from = (trigger: HTMLElement | null): MenuPlacement => {
      if (trigger === null) return NEAR;
      const at = trigger.getBoundingClientRect();
      return {
        sideOffset: Math.round(head.right - at.right + MENU_GAP),
        alignOffset: Math.round(head.top - at.top),
      };
    };
    const next = { mark: from(markRef.current), name: from(nameRef.current) };
    setBeside((last) =>
      samePlace(last.mark, next.mark) && samePlace(last.name, next.name)
        ? last
        : next,
    );
  });
  return (
    <div
      ref={headRef}
      className={styles.head}
      data-open={open ? "" : undefined}
      data-instant={byKey ? "" : undefined}
    >
      <Menu>
        <MenuTrigger asChild>
          <button
            ref={markRef}
            type="button"
            className={styles.mark}
            aria-label={words.menu}
          >
            <Mark size={28} />
          </button>
        </MenuTrigger>
        <MenuContent
          className={menuStyles.menu}
          side="right"
          align="start"
          {...beside.mark}
        >
          <MenuItem onSelect={onHome}>{words.backToProjects}</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onSettings}>{words.settings}</MenuItem>
        </MenuContent>
      </Menu>
      {titleMenu === undefined ? (
        <span className={styles.project}>{title}</span>
      ) : (
        titleMenu(
          <button ref={nameRef} type="button" className={styles.project}>
            {title}
          </button>,
          beside.name,
        )
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-label={title}
        aria-expanded={open}
        aria-controls={controls}
        aria-keyshortcuts={shortcut.key}
        title={`${open ? words.closeSidebar : words.openSidebar} (${shortcut.words})`}
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
