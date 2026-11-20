import { describe, expect, test } from "bun:test";
import {
  briefPhone,
  briefRewritten,
  briefSaturday,
  planDeadline,
  projectDrafts,
} from "./comments.fixtures.ts";
import {
  afterSent,
  commentsMessage,
  commentsSend,
  deleteDraft,
  documentDrafts,
  draftCard,
  draftsKey,
  readDrafts,
  saveDraft,
  storedDrafts,
} from "./comments.ts";

describe("which drafts exist", () => {
  test("a project's drafts are kept under its own key, beside its unsent message", () => {
    expect(draftsKey("bakery")).toBe("unsent:comments:bakery");
    expect(draftsKey("florist")).not.toBe(draftsKey("bakery"));
  });

  test("stored drafts read back as they were saved, quote and all", () => {
    expect(readDrafts(storedDrafts(projectDrafts))).toEqual([...projectDrafts]);
  });

  test("nothing stored, or what is stored unreadable, is no drafts", () => {
    expect(readDrafts(null)).toEqual([]);
    expect(readDrafts("not json")).toEqual([]);
    expect(readDrafts('{"id":"draft-phone"}')).toEqual([]);
  });

  test("a stored entry that is not a whole draft is left out, the rest kept", () => {
    const stored = JSON.stringify([
      briefPhone,
      { ...briefSaturday, quote: "  " },
      { ...planDeadline, version: "1" },
      { ...planDeadline, comment: "" },
      null,
      planDeadline,
    ]);
    expect(readDrafts(stored)).toEqual([briefPhone, planDeadline]);
  });

  test("with no drafts left, nothing is stored", () => {
    expect(storedDrafts([])).toBeNull();
  });

  test("a new draft goes last, its comment trimmed", () => {
    expect(
      saveDraft([briefPhone], { ...planDeadline, comment: "  Ship it.  " }),
    ).toEqual([briefPhone, { ...planDeadline, comment: "Ship it." }]);
  });

  test("an edited draft keeps its place and its quote", () => {
    const edited = saveDraft(projectDrafts, {
      ...briefPhone,
      comment: "Mention text orders.",
    });
    expect(edited.map((draft) => draft.id)).toEqual(
      projectDrafts.map((draft) => draft.id),
    );
    expect(edited[0]).toEqual({
      ...briefPhone,
      comment: "Mention text orders.",
    });
  });

  test("an empty comment, or one with no passage, is not saved", () => {
    expect(saveDraft([briefPhone], { ...planDeadline, comment: " " })).toEqual([
      briefPhone,
    ]);
    expect(saveDraft([briefPhone], { ...planDeadline, quote: "" })).toEqual([
      briefPhone,
    ]);
  });

  test("a deleted draft is gone and the others stay in order", () => {
    expect(deleteDraft(projectDrafts, planDeadline.id)).toEqual([
      briefPhone,
      briefSaturday,
    ]);
    expect(deleteDraft(projectDrafts, "no-such-draft")).toEqual([
      ...projectDrafts,
    ]);
  });
});

describe("where each draft sits", () => {
  test("a document shows only its own drafts, in the order they were written", () => {
    expect(documentDrafts(projectDrafts, "problem_brief")).toEqual([
      briefPhone,
      briefSaturday,
    ]);
    expect(documentDrafts(projectDrafts, "build_plan")).toEqual([planDeadline]);
    expect(documentDrafts(projectDrafts, "approaches")).toEqual([]);
  });

  test("a document's drafts show on every version of it, not only the one quoted", () => {
    expect(
      documentDrafts([briefRewritten, briefPhone], "problem_brief"),
    ).toEqual([briefRewritten, briefPhone]);
  });

  test("a draft whose quote is on the page sits level with it", () => {
    expect(draftCard(true)).toEqual({ place: "passage", showsQuote: false });
  });

  test("a draft whose quote is not on the version shown sits at the top and shows its quote", () => {
    expect(draftCard(false)).toEqual({ place: "top", showsQuote: true });
  });
});

describe("whether they can be sent", () => {
  const open = { sending: false, question: false, approval: false };

  test("with no drafts there is nothing to send", () => {
    expect(commentsSend({ ...open, drafts: [] })).toEqual({ state: "none" });
    expect(
      commentsSend({
        drafts: [],
        sending: true,
        question: true,
        approval: true,
      }),
    ).toEqual({ state: "none" });
  });

  test("with drafts and nothing open, they can be sent", () => {
    expect(commentsSend({ ...open, drafts: projectDrafts })).toEqual({
      state: "ready",
    });
  });

  test("while a message is on its way, sending waits", () => {
    expect(
      commentsSend({ ...open, drafts: projectDrafts, sending: true }),
    ).toEqual({ state: "sending" });
  });

  test("an open question comes first, since a message would answer it", () => {
    expect(
      commentsSend({
        drafts: projectDrafts,
        sending: false,
        question: true,
        approval: true,
      }),
    ).toEqual({ state: "blocked", by: "question" });
  });

  test("an open approval comes next, since a message would decline it", () => {
    expect(
      commentsSend({ ...open, drafts: projectDrafts, approval: true }),
    ).toEqual({ state: "blocked", by: "approval" });
  });
});

describe("the message they make", () => {
  test("each draft is its quote's line, then its comment, in the order written", () => {
    expect(commentsMessage([briefPhone, planDeadline])).toBe(
      [
        'On "Problem brief" v2:',
        "",
        "> Orders are taken by phone and written on paper.",
        "",
        "Mention text and walk-in orders too.",
        "",
        'On "Build plan" v1:',
        "",
        "> Two weeks to the first release.",
        "",
        "Can the order list ship first?",
      ].join("\n"),
    );
  });

  test("a quote over several lines reads as one line, as a quote did before", () => {
    expect(
      commentsMessage([
        { ...briefPhone, quote: "Orders are\n\ntaken   by phone." },
      ]),
    ).toContain("> Orders are taken by phone.\n\n");
  });

  test("one draft makes a message of its own", () => {
    expect(commentsMessage([planDeadline])).toBe(
      'On "Build plan" v1:\n\n> Two weeks to the first release.\n\nCan the order list ship first?',
    );
  });
});

describe("what is left once they went out", () => {
  test("the drafts that went out are cleared", () => {
    expect(afterSent(projectDrafts, projectDrafts)).toEqual([]);
  });

  test("a draft written while the message was on its way is kept", () => {
    const written = { ...briefRewritten, id: "draft-later" };
    expect(afterSent([...projectDrafts, written], projectDrafts)).toEqual([
      written,
    ]);
  });

  test("a draft changed while the message was on its way is kept with its change", () => {
    const changed = { ...briefPhone, comment: "Walk-ins matter most." };
    expect(
      afterSent([changed, planDeadline, briefSaturday], projectDrafts),
    ).toEqual([changed]);
  });

  test("a draft deleted while the message was on its way stays deleted", () => {
    expect(afterSent([briefPhone], projectDrafts)).toEqual([]);
  });
});
