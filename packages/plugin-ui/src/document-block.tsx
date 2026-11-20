/**
 * A filed document as the person meets it wherever it is shown: its title with its version quietly
 * beside it, its own summary under it, and one link that opens the whole document, so a document
 * reads the same whether it is put to them for approval or simply handed back finished.
 */
import { Button } from "@corbits/react-ui";
import { ExternalLink, FileText } from "lucide-react";
import { Markdown } from "./markdown.tsx";
import styles from "./document-block.module.css";

export const documentBlockText = {
  version: (version: number) => `v${String(version)}`,
  /** The version as a chip spells it out beside the title. */
  versionLong: (version: number) => `Version ${String(version)}`,
  openShort: "Open",
  open: "Read the full document",
  // Several blocks can share a card, so each link's name says which document it opens.
  openNamed: (title: string) => `Read the full document: ${title}`,
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
      <p className={styles.row}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {documentBlockText.version(version)}
          {note === undefined ? null : ` · ${note}`}
        </span>
      </p>
      {summary === undefined ? null : (
        <div className={styles.summary}>
          <Markdown source={summary} />
        </div>
      )}
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.open}
        aria-label={documentBlockText.openNamed(title)}
        onClick={() => onOpen(kind)}
      >
        {documentBlockText.open}
      </Button>
    </div>
  );
}

export type DocumentChipProps = Omit<DocumentBlockProps, "summary">;

/**
 * A filed document in one line, for when the card around it already says what is asked: its title
 * and version, and the whole chip opens it. It never repeats the question.
 */
export function DocumentChip({
  kind,
  title,
  version,
  note,
  onOpen,
}: DocumentChipProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      data-slot="document-chip"
      aria-label={documentBlockText.openNamed(title)}
      onClick={() => onOpen(kind)}
    >
      <span className={styles.chipFile} aria-hidden="true">
        <FileText />
      </span>
      <span className={styles.chipTitle}>{title}</span>
      <span className={styles.chipMeta}>
        {documentBlockText.versionLong(version)}
        {note === undefined ? null : ` · ${note}`}
      </span>
      <span className={styles.chipOpen} aria-hidden="true">
        {documentBlockText.openShort}
        <ExternalLink />
      </span>
    </button>
  );
}
