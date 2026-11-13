import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MockupReview, text } from "@plugins/designer/src/review/view.tsx";
import { MockupFrame } from "./mockup-frame.tsx";
import type { ReviewedDesign } from "./screen-question.tsx";

type Props = Parameters<typeof MockupReview>[0];

const files = {
  "designs/index.html":
    '<main><section data-screen="home"><a data-testid="home-search-link">Search</a></section></main>',
};
const box: [number, number, number, number] = [0, 0, 80, 20];
const comment = {
  text: "Make the search link bigger.",
  at: {
    page: "index.html",
    screen: "home",
    testid: "home-search-link",
    tag: "a",
    excerpt: "Search",
    box,
  },
};
const page = {
  stage: () => undefined,
  sendStaged: () => undefined,
  close: () => undefined,
};

const review = (
  design: ReviewedDesign | null,
  options: {
    earlier?: unknown;
    answer?: Props["answer"];
  } = {},
) =>
  renderToStaticMarkup(
    <MockupReview
      input={{}}
      project={{}}
      prepared={{}}
      facts={[]}
      draft={{}}
      setDraft={() => undefined}
      submit={() => Promise.resolve()}
      submitting={false}
      answer={options.answer}
      host={{
        design,
        mockupFrame: MockupFrame,
        earlierAnswer: options.earlier,
      }}
      page={page}
    />,
  );

const button = (html: string, name: string) =>
  new RegExp(`<button[^>]*>${name}</button>`).exec(html)?.[0] ?? "";
const NO_COMMENTS = text.requestChanges(0);
const disabled = (html: string, name: string) =>
  button(html, name).includes('disabled=""');

describe("mockup review", () => {
  test("a live draft cannot be approved, and says why", () => {
    const html = review({
      files,
      version: "draft",
      approval: { unavailable: "The designer is still working." },
    });
    expect(html).toContain('data-slot="gui-frame"');
    expect(disabled(html, text.approve)).toBe(true);
    expect(html).toContain("The designer is still working.");
    expect(disabled(html, NO_COMMENTS)).toBe(true);
  });

  test("the last round's comments are listed to read, not to remove", () => {
    const html = review(
      { files, version: 3, approval: { option: "design-option-1" } },
      { earlier: { decision: "changes", version: 2, comments: [comment] } },
    );
    expect(html).toContain(text.lastRound);
    expect(html).toContain(comment.text);
    expect(html).not.toContain(text.remove(1));
  });

  test("once answered it settles to one line", () => {
    const html = review(null, {
      answer: { decision: "changes", version: 2, comments: [comment] },
    });
    expect(html).toContain(text.changes(1));
    expect(html).not.toContain('data-slot="mockup-review"');
  });
});
