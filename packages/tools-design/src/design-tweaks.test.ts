import { expect, test } from "bun:test";
import { setThemeTokens } from "./design-tweaks.ts";

test("a saved primary reaches every dark rule of a shipped theme", async () => {
  const css = await Bun.file(
    new URL(
      "../../../workflows/designer/themes/modern-sleek/designs/styles.css",
      import.meta.url,
    ),
  ).text();
  const out = setThemeTokens(css, { primary: "#ff0000" });
  const systemDark = out.slice(
    out.indexOf("@media (prefers-color-scheme: dark)"),
  );
  const block = systemDark.slice(0, systemDark.indexOf("}"));
  expect(block).toContain("--primary: #ff0000");
});

test("a commented declaration is left alone", () => {
  expect(
    setThemeTokens(":root { /* --primary: red; */ --primary: blue; }", {
      primary: "#f00",
    }),
  ).toBe(":root { /* --primary: red; */ --primary: #f00; }");
});
