import { expect, test } from "bun:test";
import { CATALOG } from "@corbits-builder/hub/plugins/catalog";
import manifest from "../../package.json";
import { conceptsAbout, looksSkill } from "../default-looks.ts";
import { designThemeDocs } from "../skills.ts";

const { looks } = manifest.builder.design;

test("the coordinator reads every look the designer declares, by label and direction", () => {
  const mockup = CATALOG.actions.find(({ name }) => name === "designer mockup");
  if (!mockup) throw new Error("designer mockup is not installed");
  for (const { label, direction } of looks)
    expect(mockup.guidance).toContain(`- ${label}: ${direction}`);
});

test("a designer that declares no looks lists none", () => {
  const about = conceptsAbout([]);
  for (const { label } of looks) expect(about).not.toContain(label);
  expect(about).not.toContain("exact labels");
});

test("the looks skill gives each look its theme and what each theme is for", () => {
  const skill = looksSkill(manifest.builder.design, designThemeDocs());
  for (const { label, direction } of looks) {
    expect(skill).toContain(`- ${label} (`);
    expect(skill).toContain(direction);
  }
  expect(skill).toContain("- Bold and colourful (Retro theme):");
  for (const theme of ["Modern and sleek", "Retro", "Liquid glass"])
    expect(skill).toContain(`### ${theme} theme`);
  expect(skill).toContain("cobalt `#2747d6`");
});
