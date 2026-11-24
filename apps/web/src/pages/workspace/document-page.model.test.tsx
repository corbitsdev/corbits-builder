import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { wording } from "../../config.ts";
import type { LoadedDeliverable } from "./deliverable-block.tsx";
import {
  briefPhone,
  briefSaturday,
  projectDrafts,
} from "./comments.fixtures.ts";
import type { CommentDraft } from "./comments.ts";
import { pageComments, type DocumentPageProps } from "./document-page.model.ts";
import { WrittenDocument } from "./written-document.tsx";

const brief: LoadedDeliverable = {
  title: "Problem brief",
  mediaType: "text/markdown",
  content:
    "# Bakery orders brief\n\nSmall bakeries lose orders.\n\n## Who has it\n\nOwners.\n",
  filedAt: "2026-11-18T10:00:00.000Z",
  version: 2,
  sha256: "a".repeat(64),
  before: {
    version: 1,
    content: "Small bakeries lose some orders.",
    filedAt: "2026-11-17T10:00:00.000Z",
  },
  versions: [
    { version: 2, title: "Problem brief", mediaType: "text/markdown" },
    { version: 1, title: "Problem brief", mediaType: "text/markdown" },
  ],
};

const page = (props: Partial<DocumentPageProps> = {}) =>
  renderToStaticMarkup(
    <WrittenDocument
      project="Bakery orders"
      name="Brief"
      document={brief}
      changesOpen={false}
      onToggleChanges={() => {}}
      {...props}
    />,
  );

describe("a written document's page", () => {
  test("is titled by the document's own heading, which leaves its text", () => {
    const html = page();
    expect(html).toContain('data-slot="document-page"');
    expect(html).toContain(">Bakery orders brief</h1>");
    expect(html).not.toContain("# Bakery orders brief");
    expect(html).toContain("Small bakeries lose orders.");
  });

  test("is titled by the filed title when the text has no heading", () => {
    const html = page({
      document: { ...brief, content: "Small bakeries lose orders." },
    });
    expect(html).toContain(">Problem brief</h1>");
  });

  test("keeps a section that opens the text as a section, not the title", () => {
    const html = page({
      document: {
        ...brief,
        content: "## In short\n\n- Orders get lost.\n\n## Who has it\n",
      },
    });
    expect(html).toContain(">Problem brief</h1>");
    expect(html).toContain(`id="section-in-short">In short</h`);
  });

  test("shows neither the project nor when the version was filed on the page", () => {
    const html = page();
    expect(html).not.toContain("Bakery orders<");
    expect(html).not.toContain(wording.documentViewer.filedOn(brief.filedAt));
  });

  test("gives Download beside its contents, in words, with no bar of controls", () => {
    const html = page();
    expect(html).toContain(wording.paneFile.downloadDocument);
    expect(html).toContain(`>${wording.paneFile.download}</span>`);
    expect(html).not.toContain('data-slot="pane-bar"');
    expect(html).not.toContain(wording.versions.menu(2));
  });

  test("says when the room could not list the document's history", () => {
    expect(page({ document: { ...brief, historyError: "offline" } })).toContain(
      wording.versions.historyUnavailable("offline"),
    );
  });

  test("compares without repeating a heading both versions share", () => {
    const compared = (before: string) =>
      page({
        changesOpen: true,
        document: {
          ...brief,
          before: {
            version: 1,
            content: before,
            filedAt: "2026-11-17T10:00:00.000Z",
          },
        },
      });
    const shared = compared(
      "# Bakery orders brief\n\nSmall bakeries lose some orders.",
    );
    const text = (html: string) => html.slice(html.indexOf("</h1>"));
    expect(text(shared)).not.toContain("Bakery orders brief");
    expect(text(shared)).toContain("lose");
    const renamed = compared(
      "# Cake orders brief\n\nSmall bakeries lose some orders.",
    );
    expect(text(renamed)).toContain(
      "<del>Cake</del><ins>Bakery</ins> orders brief",
    );
  });
});

describe("a written document's comments", () => {
  const comments = (saved: CommentDraft[] = []) => ({
    document: "problem_brief",
    drafts: projectDrafts,
    onSave: (draft: CommentDraft) => saved.push(draft),
    onDelete: () => {},
  });

  test("are this document's drafts only", () => {
    expect(
      pageComments(comments(), { title: "Problem brief", version: 2 }).drafts,
    ).toEqual([briefPhone, briefSaturday]);
  });

  test("a new comment names the document and the version read", () => {
    const saved: CommentDraft[] = [];
    pageComments(
      comments(saved),
      { title: "Problem brief", version: 3 },
      () => "draft-new",
    ).onSave({ id: null, quote: "Saturdays", comment: "Which hours?" });
    expect(saved).toEqual([
      {
        id: "draft-new",
        document: "problem_brief",
        title: "Problem brief",
        version: 3,
        quote: "Saturdays",
        comment: "Which hours?",
      },
    ]);
  });

  test("an edit keeps the version its passage was quoted from", () => {
    const saved: CommentDraft[] = [];
    pageComments(comments(saved), {
      title: "Problem brief",
      version: 3,
    }).onSave({
      id: briefPhone.id,
      quote: briefPhone.quote,
      comment: "Texts too.",
    });
    expect(saved).toEqual([{ ...briefPhone, comment: "Texts too." }]);
  });
});
