import type {
  PlanChildWrite,
  PlanGroupWrite,
  PlanStepStateName,
  PlanStepWrite,
  PlanViewChild,
  PlanViewStep,
  StoredPlanChild,
  StoredPlanStep,
} from "@corbits-builder/schemas/plan";

type PlanMark = NonNullable<StoredPlanChild["goAhead"]>;

// ---- Reading a plan ----

/** Every action step of a plan, groups opened up. */
export const actionSteps = <Step extends object>(
  steps: readonly (Step | { steps: readonly Step[] })[],
) => steps.flatMap((step) => ("steps" in step ? step.steps : [step]));

/** The id of every step of a plan, each group's before those of its steps. */
export const stepIds = (
  steps: readonly (
    | { id: string }
    | { id: string; steps: readonly { id: string }[] }
  )[],
) =>
  steps.flatMap((step) => [
    step.id,
    ...("steps" in step ? step.steps : []).map(({ id }) => id),
  ]);

/** The action step with this id. */
export const stepById = <Step extends { id: string }>(
  steps: readonly (Step | { steps: readonly Step[] })[],
  id: string,
) => actionSteps(steps).find((step) => step.id === id);

/** The action steps that do this plugin action, whatever their input. */
export const stepsForAction = <Step extends { plugin: string; action: string }>(
  steps: readonly (Step | { steps: readonly Step[] })[],
  { plugin, action }: { plugin: string; action: string },
) =>
  actionSteps(steps).filter(
    (step) => step.plugin === plugin && step.action === action,
  );

/** The groups added from a ready-made plan. */
export const readyPlanGroups = <Step extends { id: string; plan?: string }>(
  steps: readonly Step[],
) =>
  steps.filter(
    (step): step is Extract<Step, { steps: unknown }> & { plan: string } =>
      "steps" in step && step.plan !== undefined,
  );

/** Whether a step waits for the person's go-ahead before it starts. */
export const awaitsGoAhead = (
  step: Pick<StoredPlanChild, "askFirst" | "goAhead">,
) => step.askFirst && step.goAhead === undefined;

// ---- Rules: where plan work stands, decided here and read everywhere else ----

/** Whether nothing more will happen to a step in this state unless the plan changes. */
export const isFinished = (state: PlanStepStateName) =>
  state === "done" || state === "skipped" || state === "cancelled";

type StepStanding = Pick<
  PlanViewChild,
  "state" | "finished" | "optional" | "runId"
>;

/**
 * An optional step nobody started leaves nothing to do: it does not hold its group open, and the
 * coordinator offers it once the rest is done. One that started keeps its group open.
 */
export const isUnstartedOptional = (step: Omit<StepStanding, "finished">) =>
  step.optional === true &&
  step.runId === undefined &&
  (step.state === "not_started" || step.state === "waiting");

/** A step that still holds its group open. */
export const isLeftToDo = (step: StepStanding) =>
  !step.finished && !isUnstartedOptional(step);

/** Where a group stands once nothing in it is left to do: cancelled if the person stopped any of it. */
export const groupEndState = (
  steps: readonly Pick<StepStanding, "state">[],
): "done" | "cancelled" =>
  steps.some((step) => step.state === "cancelled") ? "cancelled" : "done";

/** Whether the person can still drop a step: a done step stays as the record of the work. */
export const canDrop = (state: PlanStepStateName) =>
  state !== "done" && state !== "cancelled";

// ---- The person's marks: each changes the stored plan in place ----

/** Gives the go-ahead to the action steps with these ids, and returns them. */
export function giveGoAhead(
  steps: readonly StoredPlanStep[],
  ids: readonly string[],
  mark: PlanMark,
) {
  const given = actionSteps(steps).filter((step) => ids.includes(step.id));
  for (const step of given) step.goAhead = mark;
  return given;
}

/** Cancels the action steps with these ids not cancelled already, and returns them. */
export function cancelSteps(
  steps: readonly StoredPlanStep[],
  ids: readonly string[],
  mark: PlanMark,
) {
  const cancelled = actionSteps(steps).filter(
    (step) => ids.includes(step.id) && !step.cancelled,
  );
  for (const step of cancelled) step.cancelled = mark;
  return cancelled;
}

/** Declines a step with the person's mark, or restores it without one. */
export function setDeclined(step: StoredPlanChild, mark: PlanMark | undefined) {
  if (mark) step.declined = mark;
  else delete step.declined;
}

/** Sets whether a step asks first; turning it on takes back any go-ahead already given. */
export function setAskFirst(step: StoredPlanChild, askFirst: boolean) {
  step.askFirst = askFirst;
  if (askFirst) delete step.goAhead;
}

/** Marks answered the first open step for this screen, and returns it. */
export function markAnswered(
  steps: readonly StoredPlanStep[],
  screen: { plugin: string; action: string },
  mark: PlanMark,
) {
  const step = stepsForAction(steps, screen).find(
    (each) => !each.answered && !each.declined && !each.cancelled,
  );
  if (step) step.answered = mark;
  return step;
}

// ---- Changing a plan's steps ----

/** Adds these steps at the end, or after or before the step named, at its level; a group takes only action steps. */
export function insertSteps(
  steps: PlanStepWrite[],
  adding: readonly PlanStepWrite[],
  { after, before }: { after?: string; before?: string },
) {
  const next = after ?? before;
  if (next === undefined) {
    steps.push(...adding);
    return;
  }
  const offset = after === undefined ? 0 : 1;
  const at = steps.findIndex(({ id }) => id === next);
  if (at >= 0) {
    steps.splice(at + offset, 0, ...adding);
    return;
  }
  const held = adding.flatMap((each) => ("steps" in each ? [] : [each]));
  for (const step of steps) {
    if (!("steps" in step)) continue;
    const under = step.steps.findIndex(({ id }) => id === next);
    if (under >= 0) step.steps.splice(under + offset, 0, ...held);
  }
}

/** Takes out the steps with these ids, and what they hold. */
export function removeSteps(steps: PlanStepWrite[], ids: readonly string[]) {
  const kept = ({ id }: PlanStepWrite) => id === undefined || !ids.includes(id);
  for (const step of steps)
    if ("steps" in step) step.steps = step.steps.filter(kept);
  steps.splice(0, steps.length, ...steps.filter(kept));
}

// ---- Converting a step between its forms ----

function toWriteChild({
  id,
  title,
  plugin,
  action,
  input,
  askFirst,
  optional,
  approval,
  requires,
}: PlanViewChild): PlanChildWrite {
  const written: PlanChildWrite = {
    id,
    title,
    plugin,
    action,
    input,
    askFirst,
  };
  if (optional) written.optional = optional;
  if (approval) written.approval = approval;
  if (requires) written.requires = requires;
  return written;
}

/** A step as read, to save again under its id so the person's marks on it stay. */
export function toWriteStep(step: PlanViewStep): PlanStepWrite {
  if (!("steps" in step)) return toWriteChild(step);
  const group: PlanGroupWrite = {
    id: step.id,
    title: step.title,
    steps: step.steps.map(toWriteChild),
  };
  if (step.plan) group.plan = step.plan;
  return group;
}

/** A step as written, stored under this id with the person's marks and settings from marks when given. */
export function toStoredStep(
  step: PlanChildWrite,
  id: string,
  marks?: PlanChildWrite,
): StoredPlanChild {
  // A run's save of a stored step keeps whether it asks first, may be declined and its gate as stored.
  const said = marks ?? step;
  const stored: StoredPlanChild = {
    id,
    title: step.title,
    plugin: step.plugin,
    action: step.action,
    input: step.input,
    askFirst: said.askFirst,
  };
  if (said.optional) stored.optional = said.optional;
  if (said.approval) stored.approval = said.approval;
  if (said.requires) stored.requires = said.requires;
  if (marks?.goAhead) stored.goAhead = marks.goAhead;
  if (marks?.cancelled) stored.cancelled = marks.cancelled;
  if (marks?.declined && stored.optional) stored.declined = marks.declined;
  if (marks?.answered) stored.answered = marks.answered;
  return stored;
}
