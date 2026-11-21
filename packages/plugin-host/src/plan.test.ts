import { expect, test } from "bun:test";
import type { Fact } from "@corbits-builder/plugin";
import { protectedSteps, type PlanStepView } from "./plan.ts";

const records = {
  facts: new Set<Fact>(),
  personFacts: new Set<Fact>(),
  asksApprovals: true,
};
// A check step that matches a failed record some earlier plan left.
const check: PlanStepView = {
  id: "check",
  title: "Check the app",
  plugin: "tester",
  action: "check",
  input: {},
  askFirst: false,
  state: "failed",
  kind: "check",
  checkId: "earlier",
};
const build: PlanStepView = {
  id: "build",
  title: "Build the app",
  plugin: "builder",
  action: "build",
  input: {},
  askFirst: false,
  state: "not_started",
  kind: "workflow",
};
const built: PlanStepView = {
  id: "build",
  title: "Build the app",
  plugin: "builder",
  action: "build",
  input: {},
  askFirst: false,
  state: "done",
  kind: "workflow",
  runId: "run",
};

test("a plan is under way once one of its own steps has begun, not because a step matches an earlier record", () => {
  expect(protectedSteps([check, build], records)).toEqual([]);
  expect(protectedSteps([check, built], records)).toEqual([
    { step: check, reason: "underway" },
    { step: built, reason: "done" },
  ]);
});
