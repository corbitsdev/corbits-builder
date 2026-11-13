import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { documentBlockText } from "@corbits-builder/plugin-ui/document-block";
import { ApproveDocuments, text, type ShownDocument } from "./view.tsx";

// A kind no list in Builder knows, as a writer may file any document.
const manual: ShownDocument = {
  kind: "tide_table_guide",
  title: "Harbour tide table guide",
  artifactId: "art-guide",
  version: 1,
};

type Submit = Parameters<typeof ApproveDocuments>[0]["submit"];

const props = (
  document: ShownDocument,
  submit: Submit = async () => undefined,
) => ({
  input: { kinds: [document.kind] },
  project: {},
  prepared: { kinds: [document.kind] },
  facts: [],
  draft: {},
  setDraft: () => undefined,
  submit,
  submitting: false,
  answer: undefined,
  host: { documents: { list: [document], open: () => undefined } },
});

const card = (document: ShownDocument) =>
  renderToStaticMarkup(<ApproveDocuments {...props(document)} />);

type Pressable = {
  children?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
};

// The element whose own words are `label`, found through children and a card's actions.
function control(node: ReactNode, label: string): Pressable | undefined {
  if (Array.isArray(node))
    return node
      .map((child: ReactNode) => control(child, label))
      .find((found) => found !== undefined);
  if (!isValidElement<Pressable>(node)) return undefined;
  if (node.props.children === label) return node.props;
  return (
    control(node.props.actions, label) ?? control(node.props.children, label)
  );
}

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
  });

  test("a document with no summary says so, and its title still opens it", () => {
    const html = card(manual);
    expect(html).toContain(documentBlockText.noSummary);
    expect(buttons(html)).toContain(manual.title);
  });

  test("approving answers with the document at the version shown", () => {
    const answers: unknown[] = [];
    const view = ApproveDocuments(
      props({ ...manual, version: 3, summary: "- Tides." }, async (answer) => {
        answers.push(answer);
      }),
    );
    control(view, text.approve)?.onClick?.();
    expect(answers).toEqual([
      {
        approved: [
          { kind: manual.kind, artifactId: manual.artifactId, version: 3 },
        ],
      },
    ]);
  });
});
