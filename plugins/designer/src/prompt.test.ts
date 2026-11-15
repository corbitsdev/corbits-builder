import { expect, test } from "bun:test";
import { designerPrompt } from "./prompt.ts";
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

test("designerPrompt orders live-preview files before DESIGN.md and scopes styles.css and starter home.html", () => {
  const stylesIndex = designerPrompt.indexOf("- designs/styles.css:");
  const shellIndex = designerPrompt.indexOf("- designs/index.html:");
  const screensIndex = designerPrompt.indexOf("- designs/screens/<name>.html:");
  const docIndex = designerPrompt.indexOf("- DESIGN.md:");

  expect(stylesIndex).toBeGreaterThan(-1);
  expect(shellIndex).toBeGreaterThan(stylesIndex);
  expect(screensIndex).toBeGreaterThan(shellIndex);
  expect(docIndex).toBeGreaterThan(screensIndex);

  expect(designerPrompt).toContain("within the first 90 lines");
  expect(designerPrompt).toContain(
    "update :root and .dark together in a single edit",
  );
  expect(designerPrompt).toContain(
    "without rewriting the starter component rules",
  );
  expect(designerPrompt).toContain("screens/home.html is a placeholder");
  expect(designerPrompt).toContain(
    "automatically files it as your design concept's option",
  );
});
