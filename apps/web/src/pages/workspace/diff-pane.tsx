/**
 * Previous retained version against the one the plan names. No earlier
 * version is an empty history, not a diff of the document against itself.
 */
import { diffLines } from "./diff-lines.ts";

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
    return <p className="inline-note">No earlier version.</p>;
  }
  const lines = diffLines(before, after);
  return (
    <article className="document-read">
      {hideRange ? null : (
        <p className="inline-note">
          v{String(beforeVersion)} → v{String(afterVersion)}
        </p>
      )}
      <pre className="diff-lines">
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
