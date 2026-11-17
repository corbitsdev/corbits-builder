import { expect, test } from "bun:test";
import { designStarterFiles, designThemes } from "./skills.ts";

test("every starter and theme styles.css keeps :root and .dark within the first 90 lines", () => {
  const starterCss = designStarterFiles()[".builder/designs/styles.css"];
  expect(starterCss).toBeDefined();
  const stylesheets: [string, string][] = [
    ["starter", starterCss!],
    ...Object.entries(designThemes()).map(([id, files]): [string, string] => [
      id,
      files["designs/styles.css"]!,
    ]),
  ];

  for (const [name, css] of stylesheets) {
    const first90Lines = css.split("\n").slice(0, 90).join("\n");
    expect(first90Lines, `${name} :root block`).toMatch(/:root\s*\{[\s\S]*?\}/);
    expect(first90Lines, `${name} .dark block`).toMatch(
      /\.dark\s*\{[\s\S]*?\}/,
    );
  }
});
