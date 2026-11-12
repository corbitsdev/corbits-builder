import { type } from "arktype";

export const Input = type({
  "+": "reject",
  "note?": "0 < string <= 280",
});

// The place in the mockup a comment points at, as the mockup's frame reports a click on it: the
// element with the nearest data-testid, else one with an id, else the element clicked.
export const At = type({
  "+": "reject",
  page: "0 < string <= 512",
  "screen?": "0 < string <= 512",
  "state?": "0 < string <= 512",
  "testid?": "0 < string <= 512",
  "id?": "0 < string <= 512",
  tag: "0 < string <= 512",
  "excerpt?": "0 < string <= 160",
  box: ["number", "number", "number", "number"],
});

export const Comment = type({
  "+": "reject",
  text: "0 < string <= 1000",
  at: At,
});

export const Output = type({
  "+": "reject",
  decision: "'approved' | 'changes'",
  version: "number.integer > 0 | 'draft'",
  comments: Comment.array(),
  "message?": "0 < string <= 4000",
}).narrow(
  (output, ctx) =>
    output.decision === "approved" ||
    output.comments.length > 0 ||
    output.message !== undefined ||
    ctx.reject({
      path: ["comments"],
      expected: "at least one comment, or a message, to ask for changes",
    }),
);
