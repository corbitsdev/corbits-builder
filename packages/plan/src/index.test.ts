import { expect, test } from "bun:test";
import type {
  PlanChildWrite,
  PlanStepWrite,
} from "@corbits-builder/schemas/plan";
import { insertSteps, removeSteps } from "./index.ts";

const step = (id: string): PlanChildWrite => ({
  id,
  title: id,
  plugin: "designer",
  action: "mockup",
  input: {},
  askFirst: false,
});
const plan = (): PlanStepWrite[] => [
  step("design"),
  { id: "publish", title: "Publish", steps: [step("check"), step("deploy")] },
];
const publish = (...ids: string[]) => ({
  id: "publish",
  steps: ids.map((id) => ({ id })),
});

test("steps go in at the end, or beside the step named at its level", () => {
  const ended = plan();
  insertSteps(ended, [step("new")], {});
  expect(ended).toMatchObject([
    { id: "design" },
    publish("check", "deploy"),
    { id: "new" },
  ]);
  const top = plan();
  insertSteps(top, [step("new")], { after: "design" });
  expect(top).toMatchObject([
    { id: "design" },
    { id: "new" },
    publish("check", "deploy"),
  ]);
  const grouped = plan();
  insertSteps(grouped, [step("new")], { before: "deploy" });
  expect(grouped).toMatchObject([
    { id: "design" },
    publish("check", "new", "deploy"),
  ]);
});

test("taking out a step takes it out of its group, and a group with all it holds", () => {
  const steps = plan();
  removeSteps(steps, ["check"]);
  expect(steps).toMatchObject([{ id: "design" }, publish("deploy")]);
  removeSteps(steps, ["publish"]);
  expect(steps).toMatchObject([{ id: "design" }]);
});
