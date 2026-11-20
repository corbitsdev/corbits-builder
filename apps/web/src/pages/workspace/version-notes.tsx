/**
 * The short lines above a document about the version being read: an older one on show, one being
 * read, a read that failed, and a history the room could not list.
 */
import { Fault, InlineNote } from "../../components.tsx";
import { wording } from "../../config.ts";

export type VersionNotesProps = {
  /** The version on show, and the newest the plan names. */
  viewing: number;
  newest: number;
  /** A version being read, before it is shown or compared. */
  reading: number | null;
  readError: string | null;
  historyError?: string | undefined;
  /** The version a comparison waits on, while its text is read. */
  readingForComparison: number | null;
  /** The notes float over a page that fills the pane, so each is a chip. */
  pill?: boolean;
};

export function VersionNotes({
  viewing,
  newest,
  reading,
  readError,
  historyError,
  readingForComparison,
  pill = false,
}: VersionNotesProps) {
  const words = wording.versions;
  return (
    <>
      {viewing !== newest ? (
        <InlineNote role="status" pill={pill}>
          {words.showing(viewing, newest)}
        </InlineNote>
      ) : null}
      {reading !== null ? (
        <InlineNote role="status" pill={pill}>
          {words.reading(reading)}
        </InlineNote>
      ) : null}
      {readError !== null ? <Fault>{readError}</Fault> : null}
      {historyError !== undefined ? (
        <InlineNote role="status" pill={pill}>
          {words.historyUnavailable(historyError)}
        </InlineNote>
      ) : null}
      {readingForComparison !== null ? (
        <InlineNote role="status" pill={pill}>
          {words.readingForComparison(readingForComparison)}
        </InlineNote>
      ) : null}
    </>
  );
}
