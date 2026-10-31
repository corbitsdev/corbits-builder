/**
 * Two retained texts. Prose defaults to inline tracked changes; line diff
 * stays one control away. HTML and JSON stay line-based so the preview is
 * not rewritten into a different document.
 */
import { Button } from "@corbits/react-ui";
import { X } from "lucide-react";
import { useState } from "react";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";
import { markChanges } from "../../revisions.ts";
import { DiffPane } from "./diff-pane.tsx";

export function ComparisonView({
  before,
  after,
  beforeVersion,
  afterVersion,
  prose,
  onClose,
}: {
  before: string;
  after: string;
  beforeVersion: number;
  afterVersion: number;
  prose: boolean;
  onClose: () => void;
}) {
  const [lines, setLines] = useState(!prose);
  const older = Math.min(beforeVersion, afterVersion);
  const newer = Math.max(beforeVersion, afterVersion);
  const olderText = beforeVersion <= afterVersion ? before : after;
  const newerText = beforeVersion <= afterVersion ? after : before;
  return (
    <div className="workspace-comparison">
      <p className="comparison-chip">
        {wording.versions.comparing(older, newer)}
        <button
          type="button"
          aria-label={wording.versions.stopComparing}
          onClick={onClose}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </p>
      {prose ? (
        <div
          className="workspace-comparison-modes"
          role="group"
          aria-label="Comparison style"
        >
          <Button
            size="sm"
            variant={lines ? "ghost" : "secondary"}
            aria-pressed={!lines}
            onClick={() => setLines(false)}
          >
            Inline
          </Button>
          <Button
            size="sm"
            variant={lines ? "secondary" : "ghost"}
            aria-pressed={lines}
            onClick={() => setLines(true)}
          >
            Lines
          </Button>
        </div>
      ) : null}
      {prose && !lines ? (
        <div className="workspace-tracked" aria-label="Tracked changes">
          <Markdown source={markChanges(olderText, newerText)} />
        </div>
      ) : (
        <DiffPane
          before={olderText}
          after={newerText}
          beforeVersion={older}
          afterVersion={newer}
          hideRange
        />
      )}
    </div>
  );
}
