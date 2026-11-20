/**
 * A written document in the reading pane: a brief, constraints, approaches, requirements, a build
 * plan or the app's manual, read as a printed page with its sections beside it. The page's bar
 * carries the version, the page count, the zoom and the download; a passage pointed at on the page
 * can be quoted into the person's message.
 */
import type { ApproachesMeta } from "@corbits-builder/schemas/approaches";
import { DocumentView } from "@corbits-builder/plugin-ui/markdown";
import { ApproachesComparison } from "./approaches-comparison.tsx";
import { ComparisonView } from "./comparison-view.tsx";
import { DocumentPage } from "./document-page.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import { PassageQuotes, type PassageQuote } from "./passage-note.tsx";
import { VersionNotes, type VersionNotesProps } from "./version-notes.tsx";

/** What the page reads: the version's text, or that version set against an earlier one. */
export type WrittenBody =
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
  /** The project, which the page's running header names. */
  project: string;
  title: string;
  /** The running header's right side: when the version shown was filed. */
  meta: string;
  /** The bar's own groups: approval, versions and the file. */
  groups: readonly PaneBarGroup[];
  /** Lines about the version being read; absent for a document without versions. */
  notes?: VersionNotesProps | undefined;
  body: WrittenBody;
  /** Quoting a passage into the message, naming the document and the version read. */
  quote?:
    | {
        title: string;
        version: number;
        onAdd: (passage: PassageQuote) => void;
      }
    | undefined;
};

export function WrittenDocumentView({
  project,
  title,
  meta,
  groups,
  notes,
  body,
  quote,
}: WrittenDocumentViewProps) {
  const text =
    body.kind === "comparison" ? (
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
        <DocumentView
          source={body.source}
          {...(body.images === undefined ? {} : { images: body.images })}
        />
      </>
    );
  return (
    <DocumentPage
      project={project}
      title={title}
      meta={meta}
      groups={groups}
      notes={notes === undefined ? undefined : <VersionNotes {...notes} />}
    >
      {quote === undefined ? (
        text
      ) : (
        <PassageQuotes
          title={quote.title}
          version={quote.version}
          onAdd={quote.onAdd}
        >
          {text}
        </PassageQuotes>
      )}
    </DocumentPage>
  );
}
