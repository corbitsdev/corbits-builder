/**
 * What a written document's page does: read the version the person picks, compare it with the one
 * before, approve it, download it and comment on its passages. The room's read of the document and the
 * versions the hub keeps become the page's title, running header, bar and text, so the view sees
 * none of the hub's shapes.
 */
import { wording } from "../../config.ts";
import type { ApproachChoice } from "./approach-choice.ts";
import { useApproveGroup } from "./approve-group.ts";
import type { DocumentApprovalControl } from "./deliverable-block.tsx";
import { documentDrafts, type CommentDraft } from "./comments.ts";
import type { PageComments } from "./page-comments.tsx";
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
  /** The project's comment drafts, and this document's place among them; absent where it takes none. */
  comments?: DocumentComments | undefined;
};

/** The comment drafts of the project the document is in, which the room keeps. */
export type ProjectComments = {
  drafts: readonly CommentDraft[];
  onSave: (draft: CommentDraft) => void;
  onDelete: (id: string) => void;
};

export type DocumentComments = ProjectComments & {
  /** The document, by the room's id for it, which stays the same across its versions. */
  document: string;
};

const newDraftId = () =>
  `comment:${String(Date.now())}:${Math.random().toString(36).slice(2, 8)}`;

/**
 * The page's comments: this document's drafts, and saving one. A new comment names the version
 * read; an edit keeps the document and version its passage was quoted from.
 */
export function pageComments(
  comments: DocumentComments,
  reading: { title: string; version: number },
  newId: () => string = newDraftId,
): PageComments {
  const drafts = documentDrafts(comments.drafts, comments.document);
  return {
    drafts,
    onSave: ({ id, quote, comment }) => {
      const was = drafts.find((draft) => draft.id === id);
      comments.onSave(
        was === undefined
          ? {
              id: newId(),
              document: comments.document,
              title: reading.title,
              version: reading.version,
              quote,
              comment,
            }
          : { ...was, comment },
      );
    },
    onDelete: comments.onDelete,
  };
}

export function useDocumentPage({
  project,
  name,
  approval,
  approachChoice,
  comments,
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
  // The page's title already shows the heading both versions share; a heading that changed stays
  // in the comparison so the change can be seen.
  const liftedBefore = splitLeadingHeading(beforeText ?? "");
  const sameHeading = liftedBefore.heading === lifted.heading;
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
          before: sameHeading ? liftedBefore.body : beforeText,
          after: sameHeading ? lifted.body : afterText,
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
    comments:
      comments === undefined
        ? undefined
        : pageComments(comments, { title: filed, version: viewing }),
  };
}
