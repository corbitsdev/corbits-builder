import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** An error banner keeps the neutral edge. Severity is the words, not a red outline. */
test("an error banner does not draw the destructive outline", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rule = css.match(/\.banner\.is-error\s*\{[^}]*\}/);
  expect(rule?.[0] ?? "").not.toContain("--wb-destructive");
});
