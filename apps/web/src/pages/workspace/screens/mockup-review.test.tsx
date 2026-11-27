import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  keptPins,
  MockupReview,
  pinned,
} from "@plugins/designer/src/review/view.tsx";

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

test("comment edits use the current draft, including changes between two events before rendering", () => {
  let draft: Props["draft"] = { comments: [comment] };
  let tag:
    | import("@plugins/designer/src/review/view.tsx").FrameProps["onTag"]
    | undefined;
  const setDraft: Props["setDraft"] = (change) => {
    draft = Object.assign(
      {},
      draft,
      typeof change === "function" ? change(draft) : change,
    );
  };
  renderToStaticMarkup(
    <MockupReview
      prepared={{
        input: {},
        data: {},
        project: {},
        facts: [],
        resources: {
          design: {
            files,
            version: 3,
            approval: { option: "design-option-1" },
          },
          earlierAnswer: undefined,
          commentCard: () => null,
          mockupFrame: (props) => {
            tag = props.onTag;
            return null;
          },
        },
      }}
      draft={draft}
      setDraft={setDraft}
      submit={async () => undefined}
      submitting={false}
      fault={undefined}
      place="page"
      answer={undefined}
    />,
  );
  if (tag === undefined) throw new Error("Review did not render its frame");
  tag(comment.at, { spot: [0.5, 0.5], point: [40, 10] });
  setDraft({
    comments: [
      comment,
      { at: comment.at, text: "A new comment from the current draft" },
    ],
  });
  tag(comment.at, { spot: [0.25, 0.5], point: [20, 10] });
  expect(draft.comments?.map((item) => item.text)).toEqual([
    comment.text,
    "A new comment from the current draft",
    "",
  ]);
});

test("a kept comment is reworded in its own place, and words that are only spaces leave it be", () => {
  const second = { text: "Darker header.", at: comment.at };
  const kept = { ...keptPins([comment, second]), selected: 2 };
  const reworded = pinned(kept, {
    kind: "reword",
    pin: 2,
    words: " Lighter header. ",
  });
  expect(reworded.pins.map((pin) => pin.comment.text)).toEqual([
    comment.text,
    "Lighter header.",
  ]);
  expect(reworded.selected).toBe(2);
  expect(pinned(kept, { kind: "reword", pin: 2, words: "  " })).toBe(kept);
});

test("closing a pin's card keeps its comment", () => {
  const kept = { ...keptPins([comment]), selected: 1 };
  const closed = pinned(kept, { kind: "close" });
  expect(closed.selected).toBeNull();
  expect(closed.pins).toEqual(kept.pins);
});
