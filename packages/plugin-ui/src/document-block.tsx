/**
 * A filed document as the person meets it wherever it is shown: its title, which opens it, its
 * version quietly beside it, and its own summary under it, so a document reads the same whether it
 * is put to them for approval or simply handed back finished. With no summary it says so.
 */
import { Markdown } from "./markdown.tsx";
import styles from "./document-block.module.css";

export const documentBlockText = {
  version: (version: number) => `v${String(version)}`,
  noSummary: "It has no summary.",
};

export type DocumentBlockProps = {
  /** The document's kind, handed back to `onOpen`. */
  kind: string;
  title: string;
  version: number;
  /** A quiet word after the version, such as that this version is already approved. */
  note?: string | undefined;
  /** The document's own `## In short` section, as markdown, when it has one. */
  summary: string | undefined;
  onOpen: (kind: string) => void;
};

export function DocumentBlock({
  kind,
  title,
  version,
  note,
  summary,
  onOpen,
}: DocumentBlockProps) {
  return (
    <div className={styles.block} data-slot="document-block">
      <div className={styles.row}>
        <button
          type="button"
          className={styles.title}
          onClick={() => onOpen(kind)}
        >
          {title}
        </button>
        <span className={styles.meta}>
          {documentBlockText.version(version)}
          {note === undefined ? null : ` · ${note}`}
        </span>
      </div>
      {summary === undefined ? (
        <p className={styles.noSummary}>{documentBlockText.noSummary}</p>
      ) : (
        <div className={styles.summary}>
          <Markdown source={summary} />
        </div>
      )}
    </div>
  );
}
