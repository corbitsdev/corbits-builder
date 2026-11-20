/**
 * What a written document's page does: read the version the person picks, compare it with the one
 * before, approve it, download it and quote from it. The room's read of the document and the
 * versions the hub keeps become the page's title, running header, bar and text, so the view sees
 * none of the hub's shapes.
 */
import { wording } from "../../config.ts";
import type { ApproachChoice } from "./approach-choice.ts";
import { useApproveGroup } from "./approve-group.ts";
import type { DocumentApprovalControl } from "./deliverable-block.tsx";
import type { PassageQuote } from "./passage-note.tsx";
import {
  documentFile,
  fileStem,
  markdownFile,
  useFileGroup,
} from "./pane-file.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";
import { versionGroup } from "./version-menu.tsx";
import {
  useVersionReading,
  type VersionReadingInput,
} from "./version-reading.ts";
import type { WrittenDocumentViewProps } from "./written-document.view.tsx";

export type DocumentPageProps = VersionReadingInput & {
  /** The project's name, which heads the page and names the file it gives away. */
  project: string;
  /** The document's name as the pane gives it, which names the file it gives away. */
  name: string;
  /** Approving the version read; absent where it cannot be approved here. */
  approval?: DocumentApprovalControl | undefined;
  /** The person's pick of a filed approach, and how to make it. */
  approachChoice?: ApproachChoice | undefined;
  onAddToPrompt?: ((passage: PassageQuote) => void) | undefined;
};

export function useDocumentPage({
  project,
  name,
  approval,
  approachChoice,
  onAddToPrompt,
  ...reading
}: DocumentPageProps): WrittenDocumentViewProps {
  const { document, changesOpen } = reading;
  const versions = useVersionReading(reading);
  const { viewing, shown, afterText, beforeText, compareWith } = versions;
  const approveGroup = useApproveGroup(approval, viewing, document.version);
  const text = afterText ?? "";
  const files = useFileGroup(
    afterText === null
      ? null
      : documentFile(
          markdownFile(fileStem(project, name, `v${String(viewing)}`), text),
        ),
  );
  const filed =
    document.versions.find((item) => item.version === viewing)?.title ??
    document.title;
  const lifted = splitLeadingHeading(text);
  const comparing =
    changesOpen &&
    compareWith !== null &&
    beforeText !== null &&
    afterText !== null;
  const approaches = shown?.approaches;
  const filedAt = shown?.filedAt ?? document.filedAt;
  const choose =
    viewing === document.version ? approachChoice?.choose : undefined;

  return {
    project,
    title: lifted.heading ?? filed,
    meta: wording.documentViewer.filedOn(filedAt),
    groups: [
      approveGroup,
      versionGroup({
        versions: document.versions,
        viewing,
        pending: versions.pendingVersion !== null,
        canCompare: versions.predecessor !== null && !comparing,
        onView: versions.selectVersion,
        onComparePrevious: versions.comparePrevious,
      }),
      files,
    ],
    notes: {
      viewing,
      newest: document.version,
      reading: versions.pendingVersion,
      readError: versions.readError,
      historyError: document.historyError,
      readingForComparison:
        changesOpen && compareWith !== null && beforeText === null
          ? compareWith
          : null,
    },
    body: comparing
      ? {
          kind: "comparison",
          before: beforeText,
          after: afterText,
          beforeVersion: compareWith,
          afterVersion: viewing,
          onClose: versions.stopComparing,
        }
      : {
          kind: "text",
          source: lifted.body,
          approaches:
            approaches === undefined
              ? undefined
              : {
                  meta: approaches,
                  chosen: approachChoice?.chosen(approaches, filedAt),
                  onChoose: choose,
                },
        },
    quote:
      onAddToPrompt === undefined
        ? undefined
        : { title: filed, version: viewing, onAdd: onAddToPrompt },
  };
}
