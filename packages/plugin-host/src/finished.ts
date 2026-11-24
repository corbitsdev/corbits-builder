// When plan work is finished, decided here only: the hub's plan read marks every step and group with
// it, and the coordinator reads these same rules rather than its own list of states.

/** A step is finished once it is done, skipped or cancelled. */
export const stepFinished = (state: string) =>
  state === "done" || state === "skipped" || state === "cancelled";

/**
 * An optional step nobody started leaves nothing to do: it does not hold its group open, and the
 * coordinator offers it once the rest is done. One that started keeps its group open.
 */
export const unstartedOptional = (step: {
  optional?: boolean;
  runId?: string;
  state: string;
}) =>
  step.optional === true &&
  step.runId === undefined &&
  (step.state === "not_started" || step.state === "waiting");

/** Whether a plan step still holds its group open: unfinished, and not an optional step nobody started. */
export const leftToDo = (step: {
  finished: boolean;
  optional?: boolean;
  runId?: string;
  state: string;
}) => !step.finished && !unstartedOptional(step);
