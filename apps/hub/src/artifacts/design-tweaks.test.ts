import { expect, test } from "bun:test";
import { DesignTweaks } from "@corbits-builder/schemas/artifact";
import { setThemeTokens } from "./design-tweaks.ts";
import { PROJECT_VALUES, readProjectValues } from "./project-values.ts";

test("a saved primary reaches every dark rule of a shipped theme", async () => {
  const css = await Bun.file(
    new URL(
      "../../../../workflows/designer/themes/modern-sleek/designs/styles.css",
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

test("a chosen secondary font is saved as font-mono, ahead of the stylesheet's fallbacks", async () => {
  const styles = await Bun.file(
    new URL(
      "../../../../workflows/designer/starter/.builder/designs/styles.css",
      import.meta.url,
    ),
  ).text();
  const secondary = PROJECT_VALUES[1];
  const { tokens } = DesignTweaks.assert({
    tokens: {
      [secondary.token]: secondary.write("JetBrains Mono", { styles }),
    },
  });
  const saved = setThemeTokens(styles, tokens);
  expect(saved).toContain(
    '--font-mono: "JetBrains Mono", "Fira Code", Monaco, Consolas, monospace;',
  );
  expect(readProjectValues(["look.font-secondary"], { styles: saved })).toEqual(
    { "look.font-secondary": "JetBrains Mono" },
  );
});
