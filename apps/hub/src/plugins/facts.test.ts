import { expect, test } from "bun:test";
import { projectFacts } from "./facts.ts";

const filed = (kind: string, version: number, approvedVersion?: number) =>
  approvedVersion === undefined
    ? { kind, version }
    : { kind, version, approvedVersion };

const facts = (
  artifacts: ReturnType<typeof filed>[],
  preferences: Record<string, string> = {},
) => [...projectFacts({ artifacts, preferences, checks: [] })].sort();

test("a project with nothing filed has no facts", () => {
  expect(facts([])).toEqual([]);
});

test("requirements count as approved only at the version the person approved", () => {
  expect(facts([filed("product_requirements", 2)])).toEqual([
    "filed:product_requirements",
  ]);
  expect(facts([filed("product_requirements", 2, 1)])).toEqual([
    "filed:product_requirements",
  ]);
  expect(facts([filed("product_requirements", 2, 2)])).toEqual([
    "approved:product_requirements",
    "filed:product_requirements",
  ]);
});

test("when the person leaves approvals to the agent, every filed document counts as approved", () => {
  expect(
    facts([filed("product_requirements", 1), filed("build_plan", 3)], {
      agent_decides_approvals: "yes",
    }),
  ).toEqual([
    "approved:build_plan",
    "approved:product_requirements",
    "filed:build_plan",
    "filed:product_requirements",
  ]);
});

test("a design is chosen only when the person approved its current version, whoever decides the documents", () => {
  expect(facts([filed("design_option", 1), filed("design", 2, 2)])).toEqual([
    "design_chosen",
    "filed:design_option",
  ]);
  expect(
    facts([filed("design", 2)], { agent_decides_approvals: "yes" }),
  ).toEqual([]);
});

test("an imported app exists with no document filed", () => {
  expect(facts([filed("app", 1)])).toEqual(["app_exists"]);
});
