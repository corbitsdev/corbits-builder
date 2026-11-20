import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { wording } from "../../config.ts";
import type { LoadedDeliverable } from "./deliverable-block.tsx";
import type { DocumentPageProps } from "./document-page.model.ts";
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

  test("names the project and when the version shown was filed", () => {
    const html = page();
    expect(html).toContain("Bakery orders");
    expect(html).toContain(wording.documentViewer.filedOn(brief.filedAt));
  });

  test("carries the versions and the download in its bar", () => {
    const html = page();
    expect(html).toContain(wording.versions.menu(2));
    expect(html).toContain(wording.paneFile.downloadDocument);
  });

  test("offers Approve on the newest version, and says once it is approved", () => {
    const approve = async () => {};
    expect(
      page({
        approval: {
          approvedVersion: undefined,
          approvedAt: undefined,
          approve,
        },
      }),
    ).toContain(wording.documentApproval.approve(2));
    expect(
      page({
        approval: {
          approvedVersion: 2,
          approvedAt: undefined,
          approve,
        },
      }),
    ).toContain(wording.documentApproval.approved(2));
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

  test("offers quoting only where a passage can be added to the message", () => {
    expect(page()).not.toContain('data-slot="passage-notes"');
    expect(page({ onAddToPrompt: () => {} })).toContain(
      'data-slot="passage-notes"',
    );
  });
});
