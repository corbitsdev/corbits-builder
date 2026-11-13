import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import type { PlanView } from "@corbits-builder/schemas/project";
import {
  StepControls,
  groupState,
  panelSteps,
  planProgress,
} from "./plan-panel.tsx";

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

type Control = {
  children?: ReactNode;
  label?: string;
  "aria-label"?: string;
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onClick?: () => void;
};

// Every switch and button in a step's controls, by its accessible name.
function controls(node: ReactNode): Map<string, Control> {
  const found = new Map<string, Control>();
  const walk = (each: ReactNode) => {
    if (Array.isArray(each)) return each.forEach(walk);
    if (!isValidElement<Control>(each)) return;
    const name = each.props.label ?? each.props["aria-label"];
    if (name !== undefined) found.set(name, each.props);
    walk(each.props.children);
  };
  walk(node);
  return found;
}

function stepControls(child: Child) {
  const sent: unknown[] = [];
  const found = controls(
    StepControls({
      step: child,
      busy: false,
      onAskFirst: (askFirst) => sent.push({ askFirst }),
      onDecline: (declined) => sent.push({ declined }),
      onGoAhead: () => sent.push("go ahead"),
    }),
  );
  const named = (control: string) => {
    const props = found.get(`${control}: ${child.title}`);
    if (props === undefined) throw new Error(`no ${control} on ${child.id}`);
    return props;
  };
  return { found, sent, named };
}

test("flipping ask me first sends the step's new setting", () => {
  const off = stepControls(step("design", "waiting"));
  expect(off.named("Ask me first").checked).toBe(false);
  off.named("Ask me first").onCheckedChange?.(true);
  const on = stepControls({ ...step("design", "waiting"), askFirst: true });
  on.named("Ask me first").onCheckedChange?.(false);
  expect([...off.sent, ...on.sent]).toEqual([
    { askFirst: true },
    { askFirst: false },
  ]);
});

test("an optional step is skipped and brought back by its skip switch", () => {
  const open = stepControls(step("looks", "not_started", true));
  open.named("Skip").onCheckedChange?.(true);
  const skipped = stepControls({
    ...step("looks", "skipped", true),
    declined: { by: "person", at: "2026-01-01T00:00:00.000Z" },
  });
  expect(skipped.named("Skip").checked).toBe(true);
  expect(skipped.named("Ask me first").disabled).toBe(true);
  skipped.named("Skip").onCheckedChange?.(false);
  expect([...open.sent, ...skipped.sent]).toEqual([
    { declined: true },
    { declined: false },
  ]);
});

test("a step waiting on the person's go-ahead sends it", () => {
  const { named, sent } = stepControls({
    ...step("review", "needs_you"),
    askFirst: true,
  });
  named("Go ahead").onClick?.();
  expect(sent).toEqual(["go ahead"]);
});

test.each(["done", "running", "failed"] as const)(
  "a %s step that is not optional has no controls",
  (state) => {
    expect(stepControls(step("build", state)).found.size).toBe(0);
  },
);

test("an optional step has no controls once it is done or running", () => {
  expect(stepControls(step("looks", "done", true)).found.size).toBe(0);
  expect(stepControls(step("looks", "running", true)).found.size).toBe(0);
});
