/**
 * A written document's sections beside its page, under a thin rail. The section being read is
 * shaded, and a section someone has commented on carries a comment mark. The title is already on
 * the page, so the head is a short label that folds the list away and brings it back.
 */
import { useId, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
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
  sections,
  current,
  onOpen,
}: {
  sections: readonly DocumentSection[];
  /** The section being read, by its anchor; null at the top of the page. */
  current: string | null;
  /** Scrolls the page to a section. */
  onOpen: (id: string) => void;
}) {
  const words = wording.documentViewer;
  const listId = `contents-${useId()}`;
  const [open, setOpen] = useState(true);
  const listed = open && sections.length > 0;
  return (
    <nav
      className={styles.contents}
      data-slot="document-contents"
      aria-label={words.contentsLabel}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={listed ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={14} aria-hidden="true" />
        {words.contentsToggle}
      </button>
      {listed ? (
        <ol id={listId} className={styles.sections}>
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
      ) : null}
    </nav>
  );
}
