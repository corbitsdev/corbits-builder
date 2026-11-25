/**
 * A short list of the project's sections, each a row opening its section, with how it stands as a
 * quiet word at its end where it says. The list is whatever the page passes, so a section is one more item.
 */
import rowStyles from "./sidebar-row.module.css";
import styles from "./sidebar-sections.module.css";

export type SidebarSection = {
  id: string;
  label: string;
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
  return (
    <ul className={styles.sections}>
      {sections.map((section) => (
        <li key={section.id}>
          <button
            type="button"
            className={`${rowStyles.row} ${styles.row}`}
            data-opens=""
            aria-current={section.selected ? "page" : undefined}
            onClick={() => onOpen(section.id)}
          >
            <span className={rowStyles.name}>{section.label}</span>
            {section.status === undefined ? null : (
              <span className={styles.status} data-tone={section.tone}>
                {section.status}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
