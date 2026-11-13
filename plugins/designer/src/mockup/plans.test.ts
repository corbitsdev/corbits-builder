import { expect, test } from "bun:test";
import { CATALOG } from "@corbits-builder/hub/plugins/catalog";
import {
  isReadyPlan,
  selectionName,
} from "@corbits-builder/plugin-host/catalog";
import { gateOf } from "@corbits-builder/plugin-host/coordinator";

const PLANS = [
  "@corbits-builder/build-web-app",
  "@corbits-builder/build-web-app-express",
];

// The ready-made web-app plan a project that selects this package follows: its design step.
const designStep = (selected: string) => {
  const plan = CATALOG.select({
    [selectionName("build-web-app")]: selected,
  }).installed("build-web-app");
  if (!plan || !isReadyPlan(plan)) throw new Error("build-web-app is no plan");
  const step = plan.builder.steps.find(
    ({ plugin, action }) => plugin === "designer" && action === "mockup",
  );
  if (!step) throw new Error(`${selected} has no designer mockup step`);
  return step;
};

const gate = (selected: string, facts: readonly string[]) =>
  gateOf(designStep(selected), {
    facts: new Set(facts),
    personFacts: new Set(),
    asksApprovals: false,
  });

for (const selected of PLANS)
  test(`${selected}'s design step waits for the requirements`, () => {
    const before = gate(selected, []);
    expect([...before.goAhead, ...before.advice]).toContain(
      "filed:product_requirements",
    );
    const after = gate(selected, [
      "filed:product_requirements",
      "approved:product_requirements",
    ]);
    expect([...after.goAhead, ...after.advice]).toEqual([]);
  });
