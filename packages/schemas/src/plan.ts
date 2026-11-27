import { type } from "arktype";
import { AskedScreen, ShownScreen, text } from "./project.ts";

/*
 * A project's plan: the plugin actions still to run, in order. A plan step is an action step or a
 * group of action steps, one level deep. Each comes in three forms:
 *
 * - Stored: as saved, with the person's marks on it.
 * - Write: as a caller saves it; a new step has no id yet, and the hub gives it one.
 * - View: as read, with where it stands, worked out from the project's records on every read.
 *
 * Only the shapes live here; the rules for where plan work stands are in @corbits-builder/plan.
 */

// ---- Building blocks ----

const PlanStepId = type(/^[A-Za-z0-9_-]{1,32}$/);
// Who set a mark on a step, and when.
const PlanMark = type({ "+": "reject", by: "string > 0", at: "string > 0" });
// The ready-made plan a group was added as. The project follows that plan while the group is on it.
const ReadyPlanHandle = type("string > 0");

const PlanStepStateName = type(
  "'done' | 'failed' | 'running' | 'needs_you' | 'waiting' | 'not_started' | 'skipped' | 'cancelled'",
);
export type PlanStepStateName = typeof PlanStepStateName.infer;

// How a step waits for the person's go-ahead. of names the document kinds they approve, or "design"
// for the design they choose. "required" always waits for the person's own answer; "optional" waits
// only while they decide approvals rather than leaving them to Builder.
export const PlanStepApproval = type({
  "+": "reject",
  of: type("string > 0").array().atLeastLength(1),
  when: "'required' | 'optional'",
});
export type PlanStepApproval = typeof PlanStepApproval.infer;

// ---- Action steps ----

const PlanStepBody = type({
  "+": "reject",
  title: text,
  plugin: "string > 0",
  action: "string > 0",
  input: "Record<string, unknown>",
  askFirst: "boolean",
  "goAhead?": PlanMark,
  "cancelled?": PlanMark,
  // Set by the ready-made plan or the coordinator that wrote the step: the person may decline it.
  "optional?": "boolean",
  "approval?": PlanStepApproval,
  // What the step suggests having first; passed on as advice when it starts without it.
  "requires?": type("string > 0").array(),
  // Stays set until the person restores the step.
  "declined?": PlanMark,
  // Answering a screen step's screen is what doing that step means.
  "answered?": PlanMark,
});

const StoredPlanChild = PlanStepBody.merge({ "+": "reject", id: PlanStepId });
export type StoredPlanChild = typeof StoredPlanChild.infer;

const PlanChildWrite = PlanStepBody.merge({ "+": "reject", "id?": PlanStepId });
export type PlanChildWrite = typeof PlanChildWrite.infer;

const PlanViewChild = StoredPlanChild.merge({
  "+": "reject",
  state: PlanStepStateName,
  // Nothing more will happen to it unless the plan changes.
  finished: "boolean",
  kind: "'workflow' | 'screen' | 'check'",
  // One plain line: the check's summary, the run's last activity, or why it failed.
  "summary?": "string > 0",
  "evidence?": "string[]",
  // While it waits: each requirement that does not hold, with what would make it true.
  "needs?": "string[]",
  "startedAt?": "string > 0",
  "endedAt?": "string > 0",
  "runId?": "string > 0",
  "checkId?": "string > 0",
  // What the step makes, as its action's returns name it for its input: the kinds of document it
  // files, and "app" for the app.
  "makes?": "string[]",
});
export type PlanViewChild = typeof PlanViewChild.infer;

// ---- Groups: they name no action and start nothing; they stand where their steps stand ----

const StoredPlanGroup = type({
  "+": "reject",
  id: PlanStepId,
  title: text,
  "plan?": ReadyPlanHandle,
  steps: StoredPlanChild.array(),
});
export type StoredPlanGroup = typeof StoredPlanGroup.infer;

const PlanGroupWrite = type({
  "+": "reject",
  "id?": PlanStepId,
  title: text,
  "plan?": ReadyPlanHandle,
  steps: PlanChildWrite.array(),
});
export type PlanGroupWrite = typeof PlanGroupWrite.infer;

const PlanViewGroup = type({
  "+": "reject",
  id: PlanStepId,
  title: text,
  "plan?": ReadyPlanHandle,
  state: PlanStepStateName,
  // Nothing in it is left to do.
  finished: "boolean",
  "needs?": "string[]",
  steps: PlanViewChild.array(),
});
export type PlanViewGroup = typeof PlanViewGroup.infer;

// ---- The whole plan ----

const StoredPlanStep = StoredPlanChild.or(StoredPlanGroup);
export type StoredPlanStep = typeof StoredPlanStep.infer;
export const StoredPlan = type({
  "+": "reject",
  steps: StoredPlanStep.array(),
  updatedAt: "string > 0",
});
export type StoredPlan = typeof StoredPlan.infer;

const PlanStepWrite = PlanChildWrite.or(PlanGroupWrite);
export type PlanStepWrite = typeof PlanStepWrite.infer;
export const PlanWrite = type({ "+": "reject", steps: PlanStepWrite.array() });
export type PlanWrite = typeof PlanWrite.infer;

// No steps and no time when no plan was ever saved.
export const PlanView = type({
  "+": "reject",
  steps: PlanViewChild.or(PlanViewGroup).array(),
  updatedAt: "string | null",
  // Only a person's read lists them, since a screen's state may hold what no model may read.
  screens: ShownScreen.array(),
  // The hub's data for the screens of the coordinator's open questions, by question signal; only a
  // person's read lists them too.
  asked: AskedScreen.array(),
});
export type PlanView = typeof PlanView.infer;
export type PlanViewStep = PlanView["steps"][number];
