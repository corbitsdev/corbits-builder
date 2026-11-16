import { expect, test } from "bun:test";
import manifest from "../../package.json";
import { conceptsAbout, looksSkill } from "../default-looks.ts";
import { designThemeDocs } from "../skills.ts";

const { looks } = manifest.builder.design;

test("a designer that declares no looks lists none", () => {
  const about = conceptsAbout([]);
  for (const { label } of looks) expect(about).not.toContain(label);
  expect(about).not.toContain("exact labels");
});

test("the looks skill gives each theme what it is for", () => {
  const skill = looksSkill(manifest.builder.design, designThemeDocs());
  for (const { label } of looks) expect(skill).toContain(`### ${label} theme`);
  expect(skill).toContain("teal `#0f6b5c`");
});

// A theme without concrete layout rules comes out as a wireframe, so each one lays them down.
test("every theme lays down its foundations", () => {
  for (const [id, doc] of Object.entries(designThemeDocs()))
    for (const section of [
      "## Palette and roles",
      "## Type scale",
      "## Spacing and density",
      "## Layout",
      "## Components",
      "## Do and do not",
    ])
      expect(doc, `${id} ${section}`).toContain(section);
});
