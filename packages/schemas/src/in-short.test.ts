import { expect, test } from "bun:test";
import { inShort } from "./in-short.ts";

test("the summary is the In short section as written, and nothing else", () => {
  const document = [
    "# Build plan",
    "",
    "## In short",
    "",
    "- **React and Postgres**, in **three phases**.",
    "- The riskiest part is **payments**; the fallback is invoices.",
    "",
    "## Stack",
    "",
    "- React",
  ].join("\n");

  expect(inShort(document)).toBe(
    "- **React and Postgres**, in **three phases**.\n- The riskiest part is **payments**; the fallback is invoices.",
  );
  expect(inShort("# Notes\n\n## Stack\n\n- React")).toBeUndefined();
});
