/**
 * A written document in the reading pane: a brief, constraints, approaches, requirements, a build
 * plan or the app's manual, read as a printed page with its sections beside it, and Download and
 * Share beside their heading; a passage selected on the page can carry a comment in the margin,
 * kept as a draft until the person sends their comments.
 */
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import { DocumentView } from "@corbits-builder/plugin-ui/markdown";
import { useMemo, useRef } from "react";
import { ApproachesComparison } from "./approaches-comparison.tsx";
import { ComparisonView } from "./comparison-view.tsx";
import { DocumentPage } from "./document-page.tsx";
import type { PaneBarGroup } from "../pane-bar.tsx";
import { usePageComments, type PageComments } from "./page-comments.tsx";
import { VersionNotes, type VersionNotesProps } from "./version-notes.tsx";

/**
 * What the page reads: the version's text, that version set against an earlier one, or nothing yet
 * while its text is read, which the version notes say.
 */
export type WrittenBody =
  | { kind: "reading" }
  | {
      kind: "text";
      /** The document's Markdown, its own title lifted onto the page. */
      source: string;
      /** Pictures the text places, by the path it names them with. */
      images?: ReadonlyMap<string, string> | undefined;
      /** An approaches document's filed approaches, shown above its text to choose from. */
      approaches?:
        | {
            meta: ApproachesMeta;
            chosen: string | undefined;
            onChoose?:
              | ((message: string) => Promise<string | null>)
              | undefined;
          }
        | undefined;
    }
  | {
      kind: "comparison";
      before: string;
      after: string;
      beforeVersion: number;
      afterVersion: number;
      onClose: () => void;
    };

export type WrittenDocumentViewProps = {
  title: string;
  /** Download and Share, for the version read. */
  files: PaneBarGroup;
  /** Lines about the version being read; absent for a document without versions. */
  notes?: VersionNotesProps | undefined;
  body: WrittenBody;
  /** The person's comments on this document; absent where it takes none. */
  comments?: PageComments | undefined;
};

export function WrittenDocumentView({
  title,
  files,
  notes,
  body,
  comments,
}: WrittenDocumentViewProps) {
  const textRef = useRef<HTMLDivElement>(null);
  // A comparison reads two versions at once, so nothing on it is commented.
  const page = usePageComments(
    body.kind === "text" ? comments : undefined,
    textRef,
  );
  const source = body.kind === "text" ? body.source : null;
  const images = body.kind === "text" ? body.images : undefined;
  // Dragging a handle re-renders the page on every move, but the text is unchanged, so it is not
  // parsed again.
  const prose = useMemo(
    () =>
      source === null ? null : (
        <DocumentView
          source={source}
          {...(images === undefined ? {} : { images })}
        />
      ),
    [source, images],
  );
  const text =
    body.kind === "reading" ? null : body.kind === "comparison" ? (
      <ComparisonView
        before={body.before}
        after={body.after}
        beforeVersion={body.beforeVersion}
        afterVersion={body.afterVersion}
        prose
        onClose={body.onClose}
      />
    ) : (
      <>
        {body.approaches === undefined ? null : (
          <ApproachesComparison
            meta={body.approaches.meta}
            chosen={body.approaches.chosen}
            onChoose={body.approaches.onChoose}
          />
        )}
        <div ref={textRef} {...page.select}>
          {prose}
        </div>
      </>
    );
  return (
    <DocumentPage
      title={title}
      files={files}
      notes={notes === undefined ? undefined : <VersionNotes {...notes} />}
      passages={page.passages}
      margin={page.margin}
      onResize={page.resize}
      onPassagePress={page.press}
    >
      {text}
    </DocumentPage>
  );
}
