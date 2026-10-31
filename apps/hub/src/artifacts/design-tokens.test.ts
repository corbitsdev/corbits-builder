import { expect, test } from "bun:test";
import { withDesignTokens } from "./design-tokens.ts";

test("filed tokens come from styles.css and replace the front matter already there", async () => {
  const css = await Bun.file(
    new URL(
      "../../../../workflows/designer/themes/retro/designs/styles.css",
      import.meta.url,
    ),
  ).text();
  const design = withDesignTokens(
    '---\nname: "Stale"\n---\n\n# Ledger design\n',
    css,
  );
  expect(design).toStartWith('---\nname: "Ledger design"\ncolors:\n');
  expect(design).not.toContain("Stale");
  expect(design).toContain('  radius-sm: "8px"\n');
  expect(design).toContain("  font-display:\n    fontFamily: ");
  expect(design).toMatch(/\n {2}dark-background: "#[\da-f]+"\n/);
  expect(design).toEndWith("---\n\n# Ledger design\n");
});
