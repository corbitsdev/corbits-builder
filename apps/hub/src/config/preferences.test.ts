import { expect, test } from "bun:test";
import { preferenceGuidance, resolvePreferences } from "./preferences.ts";

test("all-role guidance reaches a newly declared role", () => {
  expect(
    preferenceGuidance(resolvePreferences(null), "new-specialist").some(
      (line) => line.startsWith("Technical detail:"),
    ),
  ).toBe(true);
});
