import type {
  PlanStepStateName,
  PlanViewChild,
  StoredPlanChild,
} from "@corbits-builder/schemas/plan";

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

/** Where a group stands once nothing in it is left to do. */
export function groupEndState(
  steps: readonly Pick<StepStanding, "state" | "finished">[],
): "done" | "cancelled" {
  const ended = steps.filter((step) => step.finished);
  const allCancelled =
    ended.length > 0 && ended.every((step) => step.state === "cancelled");
  return allCancelled ? "cancelled" : "done";
}

/** Whether the person can still drop a step: a done step stays as the record of the work. */
export const canDrop = (state: PlanStepStateName) =>
  state !== "done" && state !== "cancelled";
