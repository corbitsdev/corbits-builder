import { expect, test } from "bun:test";
import { uncoveredRequirements } from "./steps.ts";

const REQUIREMENTS = [
  "# Requirements",
  "## Functional requirements",
  "- FR-1: Record the day's takings.",
  "## Interface requirements",
  "- IR-1: Today screen",
  "- IR-2: Bills screen",
  "## Open questions",
  "- IR-9 is mentioned here but is not an interface requirement.",
].join("\n");

const design = (requirements: string) =>
  `# Ledger design\n\n## Screens\n\n### Today\n\n- Requirements: ${requirements}\n`;

test("a design that leaves an interface requirement uncovered fails", () => {
  expect(uncoveredRequirements(REQUIREMENTS, design("IR-1"))).toEqual(["IR-2"]);
});

test("a design that names every interface requirement passes", () => {
  expect(uncoveredRequirements(REQUIREMENTS, design("IR-1, IR-2"))).toEqual([]);
});

test("a design made without a requirements document passes", () => {
  expect(uncoveredRequirements(undefined, design("None"))).toEqual([]);
});
