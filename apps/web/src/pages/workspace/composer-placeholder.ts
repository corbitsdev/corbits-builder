/**
 * The composer's placeholder, from project status rather than the next-step
 * sentence. An open approval keeps its own line.
 */
import type {
  ProjectStatus,
  ProjectWorker,
} from "@corbits-builder/schemas/project-status";
import { wording } from "../../config.ts";
import { roleLabel } from "./roles.ts";

const copy = wording.composer;

function passAlongRole(working: readonly ProjectWorker[]): string | undefined {
  return (
    working.find((item) => item.state === "working")?.role ??
    working.find((item) => item.state === "starting")?.role
  );
}

export function composerPlaceholder(input: {
  approvalOpen: boolean;
  /** The coordinator's questions wait on the person; a message sent instead answers them in its own words. */
  questionsOpen: boolean;
  /** What the open question's screen asks of the prompt box, when it says. */
  screenReply: string | undefined;
  /** Absent until project status has loaded. */
  status: ProjectStatus | undefined;
  /** No pane deliverables, design draft, or concepts yet. */
  nothingFiled: boolean;
}): string {
  if (input.approvalOpen) return wording.approval.composerPlaceholder;
  if (input.questionsOpen)
    return input.screenReply ?? wording.questions.composerPlaceholder;
  const status = input.status;
  if (status === undefined) return copy.reply;
  const role = passAlongRole(status.working);
  if (role !== undefined) return copy.passAlong(roleLabel(role).toLowerCase());
  if (status.app.state === "running") return copy.change;
  if (status.app.state === "failed" || status.failedSpecialist !== undefined)
    return copy.fix;
  if (input.nothingFiled) return copy.making;
  return copy.reply;
}
