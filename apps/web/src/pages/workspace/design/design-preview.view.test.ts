import { expect, test } from "bun:test";
import { planPage } from "./design-preview.view.tsx";

test("a plan opens with its title and without its front matter", () => {
  const notes = `---
name: "Habit tracker (Warm)"
colors:
  background: "#fbf8f3"
---

# Habit tracker (Warm)

## Summary

A calm ledger.
`;
  expect(planPage(notes)).toBe(
    "# Habit tracker (Warm)\n\n## Summary\n\nA calm ledger.\n",
  );
  expect(planPage("# Title\n\n## Summary\n")).toBe("# Title\n\n## Summary\n");
});
