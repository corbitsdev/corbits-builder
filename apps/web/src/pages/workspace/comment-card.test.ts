import { expect, test } from "bun:test";
import { commentKey } from "./comment-card.tsx";

const press = (
  key: string,
  { shiftKey = false, isComposing = false, keyCode = 0 } = {},
) => commentKey({ key, shiftKey, isComposing, keyCode });

test("Enter saves a comment and Escape cancels it", () => {
  expect(press("Enter")).toBe("save");
  expect(press("Escape")).toBe("cancel");
});

test("Shift+Enter starts a new line", () => {
  expect(press("Enter", { shiftKey: true })).toBeNull();
  expect(press("a")).toBeNull();
});

test("Enter that ends a composition is left to the input method", () => {
  expect(press("Enter", { isComposing: true })).toBeNull();
  // Safari reports the composing Enter with isComposing already false.
  expect(press("Enter", { keyCode: 229 })).toBeNull();
});
