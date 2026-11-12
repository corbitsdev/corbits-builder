import { HUB_NOTE_LEAD } from "./resume.ts";

// The hub's note to a coordinator whose specialist stopped before it delivered its result: the plain
// line the person sees, then for the coordinator alone the run and the recorded reason as
// Interchange gave it.

type Outcome = "failed" | "cancelled";

// A run the coordinator started for a plugin action is named by that action, such as "The coder's
// change", since one role runs several actions.
const actionLines = (
  { plugin, action }: { plugin: string; action: string },
  status: Outcome,
) => {
  const words = `The ${plugin}'s ${action.replaceAll("-", " ")}`;
  return {
    line:
      status === "failed"
        ? `${words} stopped before finishing.`
        : `${words} was stopped.`,
    task: `The ${plugin} ${action} action`,
  };
};

export function specialistEndedMessage(ended: {
  runId: string;
  // The plugin action the run was started for.
  action: { plugin: string; action: string };
  status: Outcome;
  reason?: { message: string; code?: string };
}): string {
  const how = ended.status === "failed" ? "failed" : "was stopped";
  const reason = ended.reason
    ? ` Recorded reason${ended.reason.code ? ` (${ended.reason.code})` : ""}: ${ended.reason.message}`
    : "";
  const { line, task } = actionLines(ended.action, ended.status);
  return `${HUB_NOTE_LEAD}${line}\n\n${task} in run ${ended.runId} ${how} before finishing, so no result is coming from it.${reason}`;
}
