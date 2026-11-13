import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApproveDocuments,
  filedOf,
  offerOf,
  text,
  type ShownDocument,
} from "./view.tsx";

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

describe("approving a document of any kind", () => {
  test("the card names the document from the document itself", () => {
    const asked = text.ask([manual.kind]);
    expect(asked).toContain("tide table guide");
    expect(card(manual)).toContain(asked);
  });

  test("each document shows its own summary", () => {
    expect(card({ ...manual, summary: "- **High water** at dusk." })).toContain(
      "<strong>High water</strong>",
    );
  });

  test("approving answers with the document at the version shown", () => {
    const { filed, missing } = filedOf(
      [{ ...manual, version: 3, summary: "- Tides." }],
      [manual.kind],
    );
    expect(offerOf(filed, missing).accept).toEqual({
      output: {
        approved: [
          { kind: manual.kind, artifactId: manual.artifactId, version: 3 },
        ],
      },
    });
  });

  test("a document not yet filed cannot be approved", () => {
    const { filed, missing } = filedOf([manual], [manual.kind, "build_plan"]);
    expect("unavailable" in offerOf(filed, missing).accept).toBe(true);
  });
});
