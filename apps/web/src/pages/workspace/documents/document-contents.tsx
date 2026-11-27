/**
 * A written document's sections beside its page, under a thin rail. The section being read is
 * shaded, and a section someone has commented on carries a comment mark. The toggle that folds the
 * list away stands in the row of Download and Share, so the list opens beneath that row and
 * closes up into it.
 */
import { MessageSquare } from "lucide-react";
import { wording } from "../../../config.ts";
import styles from "./document-contents.module.css";

export type DocumentSection = {
  /** The heading's anchor on the page. */
  id: string;
  title: string;
  /** Someone has commented on a passage in it. */
  commented: boolean;
};

export function DocumentContents({
  id,
  open,
  sections,
  current,
  onOpen,
}: {
  /** What the toggle names as the part it opens and closes. */
  id: string;
  open: boolean;
  sections: readonly DocumentSection[];
  /** The section being read, by its anchor; null at the top of the page. */
  current: string | null;
  /** Scrolls the page to a section. */
  onOpen: (id: string) => void;
}) {
  const words = wording.documentViewer;
  return (
    <nav
      id={id}
      className={styles.contents}
      data-slot="document-contents"
      data-open={open ? "" : undefined}
      aria-label={words.contentsLabel}
    >
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
    </nav>
  );
}
