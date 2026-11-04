import { expect, test } from "bun:test";
import { askOf } from "./ask.ts";

test("design concepts outside the schema's limits are not offered", () => {
  const concept = { label: "Calm", direction: "Soft greys and wide margins." };
  expect(askOf("ask", { concepts: [concept] }).concepts).toEqual([concept]);
  expect(
    askOf("ask", { concepts: [{ ...concept, label: "x".repeat(81) }] })
      .concepts,
  ).toBeUndefined();
  expect(askOf("ask", { concepts: [null] }).concepts).toBeUndefined();
});
