import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApproveDocuments, text, type ShownDocument } from "./view.tsx";

// A kind no list in Builder knows, as a writer may file any document.
const manual: ShownDocument = {
  kind: "tide_table_guide",
  title: "Harbour tide table guide",
  artifactId: "art-guide",
  version: 1,
};

const card = (document: ShownDocument) =>
  renderToStaticMarkup(
    <ApproveDocuments
      input={{ kinds: [document.kind] }}
      project={{}}
      prepared={{ kinds: [document.kind] }}
      facts={[]}
      draft={{}}
      setDraft={() => undefined}
      submit={async () => undefined}
      submitting={false}
      answer={undefined}
      host={{ documents: { list: [document], open: () => undefined } }}
    />,
  );

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
    ([, label]) => label,
  );

describe("approving a document of any kind", () => {
  test("the card names the document from the document itself", () => {
    const asked = text.ask([manual.kind]);
    expect(asked).toContain("tide table guide");
    expect(card(manual)).toContain(asked);
  });

  test("the title opens the document, and its summary sits under it", () => {
    const html = card({ ...manual, summary: "- **High water** at dusk." });
    expect(buttons(html)).toContain(manual.title);
    expect(html).toContain("<strong>High water</strong>");
    expect(buttons(html)).not.toContain(text.readFirst);
  });

  test("a document with no summary says so and offers to read it first", () => {
    const html = card(manual);
    expect(html).toContain(text.noSummary);
    expect(buttons(html)).toContain(text.readFirst);
    expect(buttons(html)).toContain(manual.title);
  });
});
