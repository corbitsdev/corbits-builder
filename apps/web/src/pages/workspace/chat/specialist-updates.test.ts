import { expect, test } from "bun:test";
import { specialistUpdate } from "./specialist-updates.ts";

test("mail is read for its summary, and JSON that is not an envelope reads as text", () => {
  const summary = JSON.stringify({ result: { summary: "Brief drafted." } });
  expect(specialistUpdate("writer", summary, 1)?.text).toBe("Brief drafted.");
  expect(specialistUpdate("writer", "null", 1)?.text).toBe("null");
  expect(
    specialistUpdate("writer", JSON.stringify({ result: { summary: 3 } }), 1),
  ).toBeNull();
});
