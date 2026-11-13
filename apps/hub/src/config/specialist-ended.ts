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

// A repair after a failure can be long work the person has not asked for, so the coordinator asks
// first; only the hand-over that skips approvals lets it decide that alone.
const AFTER_FAILURE = {
  ask: "Tell the person what failed and what fixing it involves, and ask them before starting it again.",
  decide:
    "The person lets you decide: start it again if that fixes it, and tell them what failed.",
};

export function specialistEndedMessage(ended: {
  runId: string;
  // The plugin action the run was started for.
  action: { plugin: string; action: string };
  status: Outcome;
  reason?: { message: string; code?: string };
  // The run's last tool calls, each with the start of what it returned, oldest first.
  lastCalls: readonly string[];
  // Whether the person handed decisions over to Builder.
  agentDecides: boolean;
}): string {
  const how = ended.status === "failed" ? "failed" : "was stopped";
  const reason = ended.reason
    ? ` Recorded reason${ended.reason.code ? ` (${ended.reason.code})` : ""}: ${ended.reason.message}`
    : "";
  const { line, task } = actionLines(ended.action, ended.status);
  const note = `${HUB_NOTE_LEAD}${line}\n\n${task} in run ${ended.runId} ${how} before finishing, so no result is coming from it.${reason}`;
  if (ended.status === "cancelled") return note;
  const calls =
    ended.lastCalls.length > 0
      ? `\n\nIts last calls, oldest first, show where it went wrong:\n${ended.lastCalls.join("\n")}`
      : "";
  const next = ended.agentDecides ? AFTER_FAILURE.decide : AFTER_FAILURE.ask;
  return `${note}${calls}\n\n${next}`;
}
