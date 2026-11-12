import { expect, test } from "bun:test";
import { withoutResumeContext } from "../config/resume.ts";
import { CATALOG } from "./catalog.ts";
import { discover, withPluginHint } from "./tools.ts";

const reviewMockup = CATALOG.installed("review-mockup");

test("discover finds pick-fonts from the person's words and returns how to use it", () => {
  const found = discover({ query: "the font is ugly" });
  expect(found).toStartWith("pick-fonts runs a screen. Groups: look, type.");
  expect(found).toContain(String(CATALOG.installed("pick-fonts")?.guidance));
  expect(found).toContain(
    "Builder gives the screen the project's look.font-primary, look.font-secondary itself; do not pass them.",
  );
});

test("discover lists every plugin in a group", () => {
  expect(discover({ group: "type" })).toStartWith("pick-fonts runs a screen.");
});

test("discover with nothing matching names the groups and what is in each", () => {
  expect(discover({ query: "send an invoice" })).toBe(
    [
      'No plugin matches "send an invoice".',
      "",
      "Groups:",
      `  look: pick-colours (Shows the person the primary (brand) and background colours in use and lets them choose new ones.); pick-fonts (Shows the person the fonts in use and fonts to choose a primary and a secondary font from.); review-mockup (${reviewMockup?.description})`,
      "  colour: pick-colours (Shows the person the primary (brand) and background colours in use and lets them choose new ones.)",
      "  type: pick-fonts (Shows the person the fonts in use and fonts to choose a primary and a secondary font from.)",
      `  design: review-mockup (${reviewMockup?.description})`,
      "",
      "Call again with group set to one of them, or carry on without a plugin.",
    ].join("\n"),
  );
});

// The two look plugins compete for the same remarks; each must win its own.
test("discover ranks the colour picker first for colours and the font picker first for type", () => {
  expect(discover({ query: "the colours clash" })).toStartWith(
    "pick-colours runs a screen.",
  );
  expect(discover({ query: "the font is ugly" })).toStartWith(
    "pick-fonts runs a screen.",
  );
});

test("a field-matched hint names pick-fonts after the person's words and strips back to them", () => {
  const hinted = withPluginHint("fields", "the font is ugly");
  expect(hinted).toStartWith("the font is ugly\n\nBuilder's note");
  expect(hinted).toContain('question({ plugin: "pick-fonts" })');
  expect(withoutResumeContext(hinted)).toBe("the font is ugly");
});

// "small" is a size, not a typeface, but trigger words match it anyway: the false positive to measure.
test("a trigger hint follows a whole trigger word only", () => {
  expect(withPluginHint("triggers", "the font is too small")).toContain(
    "- pick-fonts:",
  );
  expect(withPluginHint("triggers", "I want to confront this problem")).toBe(
    "I want to confront this problem",
  );
});

test("an unrelated message, or the hint switched off, is delivered unchanged", () => {
  for (const hint of ["triggers", "fields"] as const)
    expect(withPluginHint(hint, "add a login page")).toBe("add a login page");
  expect(withPluginHint("off", "the font is ugly")).toBe("the font is ugly");
});
