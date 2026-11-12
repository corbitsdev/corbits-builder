import { expect, test } from "bun:test";
import { withoutResumeContext } from "../config/resume.ts";
import { CATALOG } from "./catalog.ts";
import { discover, withPluginHint } from "./tools.ts";

const designer = CATALOG.installed("designer");
const writer = CATALOG.installed("writer");

test("discover finds the designer from the person's words and returns how to open its screens", () => {
  const found = discover({ query: "the font is ugly" });
  expect(found).toStartWith(
    "designer runs a specialist. Groups: look, design, type, colour.",
  );
  expect(found).toContain(String(designer?.guidance));
  expect(found).toContain(
    "Builder gives the screen the project's look.font-primary, look.font-secondary itself; do not pass them.",
  );
  expect(found).toContain(
    'Open it with question({ plugin: "designer", action: "pick-fonts", input }).',
  );
});

test("discover lists every plugin in a group", () => {
  expect(discover({ group: "type" })).toStartWith(
    "designer runs a specialist.",
  );
});

test("discover with nothing matching names the groups and what is in each", () => {
  const listed = `designer (${designer?.description})`;
  const documents = `writer (${writer?.description})`;
  expect(discover({ query: "send an invoice" })).toBe(
    [
      'No plugin matches "send an invoice".',
      "",
      "Groups:",
      `  look: ${listed}`,
      `  design: ${listed}`,
      `  type: ${listed}`,
      `  colour: ${listed}`,
      `  documents: ${documents}`,
      `  plan: ${documents}`,
      `  review: ${documents}`,
      `  approval: ${documents}`,
      "",
      "Call again with group set to one of them, or carry on without a plugin.",
    ].join("\n"),
  );
});

test("a field-matched hint names the font picker alone after the person's words and strips back to them", () => {
  const hinted = withPluginHint("fields", "the font is ugly");
  expect(hinted).toStartWith("the font is ugly\n\nBuilder's note");
  expect(hinted).toContain(
    'question({ plugin: "designer", action: "pick-fonts" })',
  );
  expect(hinted).not.toContain("pick-colours");
  expect(withoutResumeContext(hinted)).toBe("the font is ugly");
});

// "small" is a size, not a typeface, but trigger words match it anyway: the false positive to measure.
test("a trigger hint follows a whole trigger word only", () => {
  expect(withPluginHint("triggers", "the font is too small")).toContain(
    "- designer pick-fonts:",
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
