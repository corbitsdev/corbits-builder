import { expect, test } from "bun:test";
import type { PlanView } from "@corbits-builder/schemas/project";
import { groupState, panelSteps, planProgress } from "./plan-panel.tsx";

type Child = Extract<PlanView["steps"][number], { plugin: string }>;
type State = Child["state"];

const step = (id: string, state: State, optional = false): Child => ({
  id,
  title: id,
  plugin: "writer",
  action: id,
  input: {},
  askFirst: false,
  optional,
  state,
  kind: "workflow",
});

// The web-app ready-made plan as the walk left it once the app was built: two optional steps
// never started.
const built = [
  step("requirements", "done"),
  step("looks", "not_started", true),
  step("design", "done"),
  step("build-plan", "done"),
  step("build", "done"),
  step("manual", "not_started", true),
];

const readyMade = (steps: Child[]): PlanView["steps"] => [
  {
    id: "web-app",
    title:
      "A ready-made plan for a web app: requirements, a design, a build plan, then the build.",
    plan: "build-web-app",
    state: "not_started",
    steps,
  },
];

test("the plan counts the steps inside a ready-made plan, not the group", () => {
  const progress = planProgress(readyMade(built));
  expect(progress?.done).toBe(4);
  expect(progress?.total).toBe(6);
  expect(progress?.marks.map(({ id }) => id)).toEqual(
    built.map(({ id }) => id),
  );
});

test("a skipped or cancelled step is not counted as still to do", () => {
  const progress = planProgress(
    readyMade([
      step("requirements", "done"),
      step("looks", "skipped", true),
      step("design", "cancelled"),
      step("build", "needs_you"),
    ]),
  );
  expect(progress?.done).toBe(1);
  expect(progress?.total).toBe(2);
  expect(progress?.alert).toBe("needs_you");
});

test("a group stands where its steps do", () => {
  expect(groupState([step("a", "not_started"), step("b", "waiting")])).toBe(
    "not_started",
  );
  expect(groupState([step("a", "done"), step("b", "not_started")])).toBe(
    "running",
  );
  expect(groupState([step("a", "done"), step("b", "skipped", true)])).toBe(
    "done",
  );
  expect(groupState([step("a", "done"), step("b", "failed")])).toBe("failed");
  expect(groupState([step("a", "running"), step("b", "needs_you")])).toBe(
    "needs_you",
  );
});

test("a ready-made plan's steps stand on their own, without its description as a heading", () => {
  expect(panelSteps(readyMade(built))).toEqual(built);
});

test("any other group keeps its title and takes its state from its steps", () => {
  const [group] = panelSteps([
    {
      id: "polish",
      title: "Polish",
      state: "not_started",
      steps: [step("a", "done"), step("b", "not_started")],
    },
  ]);
  expect(group?.title).toBe("Polish");
  expect(group?.state).toBe("running");
});
