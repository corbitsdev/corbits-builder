import { describe, expect, test } from "bun:test";
import { checkInput, checkOutput } from "@corbits-builder/plugin";
import screen from "./screen.ts";

const check = (output: unknown) =>
  checkOutput("designer review", screen, output);

const box: [number, number, number, number] = [12, 40, 120, 32];
// A comment as the frame reports a click on the search link of the home screen.
const comment = {
  text: "Make the search link bigger.",
  at: {
    page: "index.html",
    screen: "home",
    state: "populated",
    testid: "home-search-link",
    tag: "a",
    excerpt: "Search",
    box,
  },
};

describe("review output", () => {
  test("asking for changes with no comment and no message is refused", () => {
    const result = check({ decision: "changes", version: 2, comments: [] });
    if (result.ok) throw new Error("an empty request for changes was taken");
    expect(result.refusal.field).toBe("comments");
    expect(result.text).toContain("at least one comment, or a message");
  });

  test("an approval needs no comment", () => {
    const result = check({
      decision: "approved",
      version: 2,
      option: "design-option-1",
      comments: [],
    });
    if (!result.ok) throw new Error(result.text);
    expect(result.output.decision).toBe("approved");
  });

  test("a comment names the place it points at", () => {
    const result = check({
      decision: "changes",
      version: "draft",
      comments: [comment],
      message: "Also try a darker blue.",
    });
    if (!result.ok) throw new Error(result.text);
    expect(result.output.comments[0]?.at).toEqual(comment.at);
  });

  test("a reference without the page or the box it was drawn in is refused", () => {
    const result = check({
      decision: "changes",
      version: 2,
      comments: [{ text: comment.text, at: { tag: "a", testid: "x" } }],
    });
    expect(result.ok).toBe(false);
  });
});

test("the coordinator passes only a note; the design is the host's", () => {
  const take = (input: unknown) =>
    checkInput("designer review", screen, input, undefined, {}).ok;
  expect(take({})).toBe(true);
  expect(take({ note: "The search link is bigger now." })).toBe(true);
  expect(take({ design: "v2" })).toBe(false);
});
