import type { SpawnedRole } from "@corbits-builder/schemas/installed-workflows";
import { HUB_NOTE_LEAD } from "./resume.ts";

// The hub's note to a coordinator whose specialist stopped before it delivered its result: the plain
// line the person sees, then for the coordinator alone the run and the recorded reason as
// Interchange gave it.

type Outcome = "failed" | "cancelled";

const PERSON_LINES: Record<SpawnedRole, Record<Outcome, string>> = {
  writer: {
    failed: "The writer stopped before finishing.",
    cancelled: "The writer was stopped.",
  },
  reviewer: {
    failed: "The reviewer stopped before finishing.",
    cancelled: "The review was stopped.",
  },
  coder: {
    failed: "The app builder stopped before finishing.",
    cancelled: "The build was stopped.",
  },
  designer: {
    failed: "The designer stopped before finishing.",
    cancelled: "The design was stopped.",
  },
  presenter: {
    failed: "The presenter stopped before finishing.",
    cancelled: "The presentation was stopped.",
  },
};

const TASKS: Record<SpawnedRole, (kind: string | undefined) => string> = {
  writer: (kind) => `The writer writing the ${kind ?? "assigned"} document`,
  reviewer: (kind) =>
    `The reviewer checking the ${kind ?? "assigned"} document`,
  coder: () => "The coder building the app",
  designer: () => "The designer working on the app's design",
  presenter: () => "The presenter building the approval package",
};

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
  role: SpawnedRole;
  kind?: string;
  // The plugin action the run was started for, when the coordinator started it with execute.
  action?: { plugin: string; action: string };
  status: Outcome;
  reason?: { message: string; code?: string };
}): string {
  const how = ended.status === "failed" ? "failed" : "was stopped";
  const reason = ended.reason
    ? ` Recorded reason${ended.reason.code ? ` (${ended.reason.code})` : ""}: ${ended.reason.message}`
    : "";
  const { line, task } = ended.action
    ? actionLines(ended.action, ended.status)
    : {
        line: PERSON_LINES[ended.role][ended.status],
        task: TASKS[ended.role](ended.kind),
      };
  return `${HUB_NOTE_LEAD}${line}\n\n${task} in run ${ended.runId} ${how} before finishing, so no result is coming from it.${reason}`;
}
