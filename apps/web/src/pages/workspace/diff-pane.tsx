/**
 * Previous retained version against the one the plan names. No earlier
 * version is an empty history, not a diff of the document against itself.
 */
import { InlineNote } from "../../components.tsx";
import { diffLines } from "./diff-lines.ts";
import styles from "./diff-pane.module.css";

export function DiffPane({
  before,
  after,
  beforeVersion,
  afterVersion,
  hideRange = false,
}: {
  before: string | null;
  after: string;
  beforeVersion: number | null;
  afterVersion: number | null;
  /** The comparison header already names the versions. */
  hideRange?: boolean;
}) {
  if (before === null || beforeVersion === null || afterVersion === null) {
    return <InlineNote>No earlier version.</InlineNote>;
  }
  const lines = diffLines(before, after);
  return (
    <article className={styles.read} data-slot="diff-pane">
      {hideRange ? null : (
        <InlineNote>
          v{String(beforeVersion)} → v{String(afterVersion)}
        </InlineNote>
      )}
      <pre className={styles.lines}>
        {lines.map((line, index) => (
          <div key={`${line.sign}:${String(index)}`}>
            {line.sign}
            {line.text}
          </div>
        ))}
      </pre>
    </article>
  );
}
