/**
 * The sidebar's title row: the mark, whose menu leads back to the projects or to Preferences, and the
 * name, which opens a menu of its own where there is one. The two are separate buttons, each lit on
 * its own and set apart by a hairline, so neither reads as part of the other.
 */
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
};

export function SidebarHeader({
  title,
  titleMenu,
  onHome,
  onPreferences,
}: SidebarHeaderProps) {
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
  return (
    <div
      ref={headRef}
      className={styles.head}
      onPointerDownCapture={(event) => placeFrom(event.target)}
      onKeyDownCapture={(event) => placeFrom(event.target)}
    >
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className={styles.mark} aria-label={words.menu}>
            <span className={styles.logo}>
              <Mark size={28} />
            </span>
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
      <span className={styles.rule} aria-hidden="true" />
      {titleMenu === undefined ? (
        <span className={styles.project}>
          <span className={styles.name}>{title}</span>
        </span>
      ) : (
        // The chevron at the row's end says the name opens a menu, as a select's would; name and
        // chevron are one trigger.
        titleMenu(
          <button type="button" className={styles.project}>
            <span className={styles.name}>{title}</span>
            <ChevronDown className={styles.chevron} aria-hidden="true" />
          </button>,
          placement,
        )
      )}
    </div>
  );
}
