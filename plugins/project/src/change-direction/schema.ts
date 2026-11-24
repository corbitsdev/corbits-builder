import { type } from "arktype";

// The plan steps the new direction leaves out, and what happens instead.
export const Input = type({
  "+": "reject",
  stepIds: type("string > 0").array().atLeastLength(1),
  instead: "string > 0",
});

// The ids of the steps the person agreed to stop, as they were shown them, or null when they keep
// the plan.
export const Output = type({
  "+": "reject",
  agreed: type("string > 0").array().or("null"),
});
