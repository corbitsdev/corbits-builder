import { type } from "arktype";
import { AskedScreen, ShownScreen, text } from "./project.ts";

// When a ready-made plan's step waits for the person's go-ahead: required always waits for the
// person's own answer, even when they left approvals to Builder; optional waits only while they
// decide approvals.
const ApprovalWhen = type("'required' | 'optional'");

// How a step asks for the person's go-ahead: of names the document kinds they approve, and
// "design" for the design they choose; when says when it waits.
export const Approval = type({
  "+": "reject",
  of: type("string > 0").array().atLeastLength(1),
  when: ApprovalWhen,
});
export type Approval = typeof Approval.infer;

// The plan the coordinator and the person keep for a project: the plugin actions still to run, in
// order. A step is either an action step or a group that only holds action steps, one level deep.
const PlanStepId = type(/^[A-Za-z0-9_-]{1,32}$/);
const PlanMark = type({ "+": "reject", by: "string > 0", at: "string > 0" });
const PlanStepBody = type({
  "+": "reject",
  title: text,
  plugin: "string > 0",
  action: "string > 0",
  input: "Record<string, unknown>",
  // The person wants to be consulted before this step starts.
  askFirst: "boolean",
  "goAhead?": PlanMark,
  "cancelled?": PlanMark,
  // Whether the person may decline the step, as the ready-made plan it came from or the
  // coordinator that wrote it says.
  "optional?": "boolean",
  // The step's gate. approval holds it until the person approves each document kind in of, or
  // chooses a design for "design": required always on the person's own answer, optional only while
  // they decide approvals; without approval it asks for none. requires is what the step suggests
  // having first, passed on as advice when it starts without it.
  "approval?": Approval,
  "requires?": type("string > 0").array(),
  // The person said no to an optional step; it stays declined until they restore it.
  "declined?": PlanMark,
  // The person answered the step's screen, which does a screen step.
  "answered?": PlanMark,
});
const StoredPlanChild = PlanStepBody.merge({ "+": "reject", id: PlanStepId });
export type StoredPlanChild = typeof StoredPlanChild.infer;
// The handle of the ready-made plan a group was added as; the project follows that plan while the
// group is on the plan.
const readyPlan = "string > 0";
// A group names no action and starts nothing; where it stands is worked out from its steps.
const StoredPlanGroup = type({
  "+": "reject",
  id: PlanStepId,
  title: text,
  "plan?": readyPlan,
  steps: StoredPlanChild.array(),
});
export type StoredPlanGroup = typeof StoredPlanGroup.infer;
export const StoredPlanStep = StoredPlanChild.or(StoredPlanGroup);
export type StoredPlanStep = typeof StoredPlanStep.infer;
export const StoredPlan = type({
  "+": "reject",
  steps: StoredPlanStep.array(),
  updatedAt: "string > 0",
});
export type StoredPlan = typeof StoredPlan.infer;
const PlanStepStateName = type(
  "'done' | 'failed' | 'running' | 'needs_you' | 'waiting' | 'not_started' | 'skipped' | 'cancelled'",
);
export type PlanStepStateName = typeof PlanStepStateName.infer;
// Where a step stands, worked out from the project's records each time the plan is read.
const PlanStepState = type({
  "+": "reject",
  state: PlanStepStateName,
  // Done, skipped or cancelled: nothing more will happen to it unless the plan changes.
  finished: "boolean",
  kind: "'workflow' | 'screen' | 'check'",
  // One plain line: the check's summary, the run's last activity, or why it failed.
  "summary?": "string > 0",
  "evidence?": "string[]",
  // While it waits, each requirement that does not hold, with what would make it true.
  "needs?": "string[]",
  "startedAt?": "string > 0",
  "endedAt?": "string > 0",
  // The latest run or check record for the step.
  "runId?": "string > 0",
  "checkId?": "string > 0",
});
const PlanViewChild = StoredPlanChild.merge(PlanStepState);
export type PlanViewChild = typeof PlanViewChild.infer;
// The plan as read, each step with where it stands: no steps and no time when none was ever saved.
const PlanViewGroup = type({
  "+": "reject",
  id: PlanStepId,
  title: text,
  "plan?": readyPlan,
  state: PlanStepStateName,
  // Nothing in it is left to do: every step is finished, apart from optional steps nobody started.
  finished: "boolean",
  "needs?": "string[]",
  steps: PlanViewChild.array(),
});
export type PlanViewGroup = typeof PlanViewGroup.infer;
export const PlanView = type({
  "+": "reject",
  steps: PlanViewChild.or(PlanViewGroup).array(),
  updatedAt: "string | null",
  // Only a person's read lists them, since a screen's state may hold what no model may read.
  screens: ShownScreen.array(),
  // What the hub prepared for the screens of the coordinator's questions, by each question's
  // signal, for those that prepare from the project; only a person's read lists them too.
  asked: AskedScreen.array(),
});
export type PlanView = typeof PlanView.infer;
export type PlanViewStep = PlanView["steps"][number];
// A saved step may leave its id out; the hub assigns one.
const PlanChildWrite = PlanStepBody.merge({
  "+": "reject",
  "id?": PlanStepId,
});
export type PlanChildWrite = typeof PlanChildWrite.infer;
export const PlanStepWrite = PlanChildWrite.or({
  "+": "reject",
  "id?": PlanStepId,
  title: text,
  "plan?": readyPlan,
  steps: PlanChildWrite.array(),
});
export type PlanStepWrite = typeof PlanStepWrite.infer;
export const PlanWrite = type({ "+": "reject", steps: PlanStepWrite.array() });
export type PlanWrite = typeof PlanWrite.infer;

/** A step is finished once it is done, skipped or cancelled. */
export const stepFinished = (state: PlanStepStateName) =>
  state === "done" || state === "skipped" || state === "cancelled";

/**
 * An optional step nobody started leaves nothing to do: it does not hold its group open, and the
 * coordinator offers it once the rest is done. One that started keeps its group open.
 */
export const unstartedOptional = (step: {
  optional?: boolean;
  runId?: string;
  state: PlanStepStateName;
}) =>
  step.optional === true &&
  step.runId === undefined &&
  (step.state === "not_started" || step.state === "waiting");

/** Whether a plan step still holds its group open: unfinished, and not an optional step nobody started. */
export const leftToDo = (step: {
  finished: boolean;
  optional?: boolean;
  runId?: string;
  state: PlanStepStateName;
}) => !step.finished && !unstartedOptional(step);
