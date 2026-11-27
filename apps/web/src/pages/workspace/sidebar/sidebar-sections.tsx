/**
 * The project's sections, each a card of its own holding one row that opens its section: an icon
 * where it has one, its name, and how it stands as a quiet word at its end where it says. The list
 * is whatever the page passes, so a section is one more item.
 */
import { BookOpen, MonitorPlay, type LucideIcon } from "lucide-react";
import { SidebarSurface } from "../../../sidebar-shell.tsx";
import rowStyles from "./sidebar-row.module.css";
import styles from "./sidebar-sections.module.css";

/** The icons a section may lead with, by name, so the model that lists them draws nothing. */
const ICONS = {
  "monitor-play": MonitorPlay,
  "book-open": BookOpen,
} satisfies Record<string, LucideIcon>;

export type SidebarSection = {
  id: string;
  label: string;
  /** What leads the row; absent, the name does. */
  icon?: keyof typeof ICONS | undefined;
  /** How the section stands, said quietly at the row's end. */
  status?: string | undefined;
  /** Said in the destructive colour, for a section that has gone wrong. */
  tone?: "destructive" | undefined;
  /** The section is on the page; its row is marked. */
  selected: boolean;
};

export type SidebarSectionsProps = {
  sections: readonly SidebarSection[];
  onOpen: (id: string) => void;
};

export function SidebarSections({ sections, onOpen }: SidebarSectionsProps) {
  return sections.map((section) => {
    const Icon = section.icon === undefined ? null : ICONS[section.icon];
    return (
      <SidebarSurface key={section.id}>
        <button
          type="button"
          className={`${rowStyles.row} ${styles.row}`}
          data-opens=""
          aria-current={section.selected ? "page" : undefined}
          onClick={() => onOpen(section.id)}
        >
          {Icon === null ? null : (
            <Icon className={styles.icon} aria-hidden="true" />
          )}
          <span className={rowStyles.name}>{section.label}</span>
          {section.status === undefined ? null : (
            <span className={styles.status} data-tone={section.tone}>
              {section.status}
            </span>
          )}
        </button>
      </SidebarSurface>
    );
  });
}
