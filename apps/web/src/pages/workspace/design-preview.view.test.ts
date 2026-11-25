import { expect, test } from "bun:test";
import { planText } from "./design-preview.view.tsx";

test("a plan opens without its front matter or title", () => {
  const notes = `---
name: "Habit tracker (Warm)"
colors:
  background: "#fbf8f3"
---

# Habit tracker (Warm)

## Summary

A calm ledger.
`;
  expect(planText(notes)).toBe("## Summary\n\nA calm ledger.\n");
  expect(planText("# Title\n\n## Summary\n")).toBe("## Summary\n");
});
