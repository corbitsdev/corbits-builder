import { expect, test } from "bun:test";
import { clippedTurnText, deliveredText, maxTurnText } from "./conversation.ts";

test("a 200,000-space run inside a line stays while the line's trailing blanks go", () => {
  const text = `a${" ".repeat(200_000)}b`;
  expect(deliveredText(`${text}\t \r\n`)).toBe(text);
});

test("a turn clipped at its limit never keeps half of an emoji", () => {
  const text = `${"a".repeat(maxTurnText - 1)}😀 more`;
  expect(clippedTurnText(text)).toBe("a".repeat(maxTurnText - 1));
});
