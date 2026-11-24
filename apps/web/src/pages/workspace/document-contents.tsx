/**
 * A written document's sections beside its page: what can be done with the document above them,
 * then the document's name and each section under a thin rail. The section being read is lifted onto the page colour, and a section someone has
 * commented on carries a comment mark.
 */
import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { wording } from "../../config.ts";
import styles from "./document-contents.module.css";

export type DocumentSection = {
  /** The heading's anchor on the page. */
  id: string;
  title: string;
  /** Someone has commented on a passage in it. */
  commented: boolean;
};

export function DocumentContents({
  title,
  sections,
  current,
  onOpen,
  actions = null,
}: {
  title: string;
  sections: readonly DocumentSection[];
  /** The section being read, by its anchor; null at the top of the page. */
  current: string | null;
  /** Scrolls the page to a section, or to its top for null. */
  onOpen: (id: string | null) => void;
  /** What can be done with the document, above its sections. */
  actions?: ReactNode;
}) {
  const words = wording.documentViewer;
  return (
    <nav
      className={styles.contents}
      data-slot="document-contents"
      aria-label={words.contentsLabel}
    >
      {actions === null ? null : <div className={styles.top}>{actions}</div>}
      <button
        type="button"
        className={styles.document}
        onClick={() => onOpen(null)}
      >
        {title}
      </button>
      {sections.length === 0 ? null : (
        <ol className={styles.sections}>
          {sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className={styles.section}
                aria-current={section.id === current ? "location" : undefined}
                onClick={() => onOpen(section.id)}
              >
                <span className={styles.name}>{section.title}</span>
                {section.commented ? (
                  <MessageSquare
                    size={14}
                    aria-label={words.commented}
                    role="img"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
