import { expect, test } from "bun:test";
import { occurrenceAt, passageStart, sectionRead } from "./document-page.tsx";

const headings = [
  { id: "problem", top: -400 },
  { id: "users", top: 54 },
  { id: "success", top: 180 },
  { id: "bounds", top: 620 },
];

test("the section read is the last whose heading reached the top, not one further down the view", () => {
  // A jump to Users puts its heading at the top; Success, a short section, starts just below it.
  expect(sectionRead(headings, 54, null)).toBe("users");
});

test("above the first heading no section is read", () => {
  expect(sectionRead([{ id: "problem", top: 300 }], 54, null)).toBeNull();
});

test("scrolled to the foot, the last heading in view is read, as short closing sections never reach the top", () => {
  expect(sectionRead(headings, 54, 900)).toBe("bounds");
  expect(sectionRead(headings, 54, 400)).toBe("success");
});

test("a short quote that recurs is found at the run that was selected, not its first", () => {
  const text =
    "Cake orders come in by phone. Lost orders hurt nobody but the bakery.";
  const selected = text.indexOf("nobody") + 4;
  const occurrence = occurrenceAt(text, "d", selected);
  expect(passageStart(text, { quote: "d", occurrence })).toBe(selected);
});
