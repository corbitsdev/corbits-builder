import { type } from "arktype";

export const Input = type({
  "+": "reject",
  "note?": "0 < string <= 280",
});

export const Comment = type({
  "+": "reject",
  concept: "0 < string <= 512",
  text: "0 < string <= 1000",
});

// The choice names the concept's design option, at the filed version the person was shown.
export const Output = type({
  "+": "reject",
  concept: "0 < string <= 512",
  option: "string > 0",
  version: "number.integer > 0",
  comments: Comment.array(),
});
