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
  onOpen: (kind: string) => void;
} & (
  | {
      compact?: false;
      /** The document's own `## In short` section, as markdown, when it has one. */
      summary: string | undefined;
    }
  /**
   * One line, for when the card around it already says what is asked: its title, and the whole
   * line opens it. It never repeats the question.
   */
  | { compact: true; summary?: never }
);

export function DocumentBlock(props: DocumentBlockProps) {
  const { kind, title, version, note, onOpen } = props;
  if (props.compact === true) {
    // Named by what it shows, Open included, so a spoken "Open" or the title reaches it.
    return (
      <button
        type="button"
        className={styles.compact}
        data-slot="document-block"
        data-size="compact"
        onClick={() => onOpen(kind)}
      >
        <span className={styles.compactFile} aria-hidden="true">
          <FileText />
        </span>
        <span className={styles.compactTitle}>{title}</span>
        <span className={styles.compactMeta}>{note}</span>
        <span className={styles.compactOpen}>
          {documentBlockText.openShort}
          <ExternalLink aria-hidden="true" />
        </span>
      </button>
    );
  }
  const { summary } = props;
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
