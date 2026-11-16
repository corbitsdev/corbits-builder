import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { roleOf, ROLES } from "../plugins/catalog.ts";
import { SIGN_IN_REJECTED } from "../workflows/director.ts";

// The hub's mail to a coordinator whose specialist stopped before it delivered its result. It
// reaches the coordinator as the person's message. The fixed lead and the plain first paragraph are
// what the person sees, as a quiet line rather than as words they typed; the paragraph after it is
// for the coordinator only and quotes the recorded reason as Interchange gave it.
export const SPECIALIST_ENDED_LEAD = "Status update: ";

const COORDINATOR_ONLY = "\n\n";

type Outcome = "failed" | "cancelled";

const SIGN_IN_REJECTED_LINE =
  "The work stopped because your model provider rejected its sign-in. Reconnect the provider in Settings, Providers, then send your request again.";

// Every role's ended lines, so a notice is told from words a person typed.
const NOTICE_LINES = new Set(
  ROLES.flatMap(({ ended }) => (ended ? [ended.failed, ended.cancelled] : [])),
).add(SIGN_IN_REJECTED_LINE);

export function specialistEndedMessage(ended: {
  role: WorkflowRole;
  kind?: string;
  status: Outcome;
  reason?: { message: string; code?: string };
}): string {
  const how = ended.status === "failed" ? "failed" : "was stopped";
  const reason = ended.reason
    ? ` Recorded reason${ended.reason.code ? ` (${ended.reason.code})` : ""}: ${ended.reason.message}`
    : "";
  const lines = roleOf(ended.role).ended;
  if (!lines)
    throw new Error(`The role ${ended.role} declares no ended notice`);
  const task = lines.task.replaceAll("{kind}", ended.kind ?? "assigned");
  // Interchange records only the text of the director's error, behind prefixes of its own.
  const personLine = ended.reason?.message.includes(SIGN_IN_REJECTED)
    ? SIGN_IN_REJECTED_LINE
    : lines[ended.status];
  return `${SPECIALIST_ENDED_LEAD}${personLine}${COORDINATOR_ONLY}${task} ${how} before finishing, so no result is coming from it.${reason}`;
}

/** A person-sent turn as the person may read it: a specialist-ended notice loses its coordinator-only part. */
export function personTurnText(text: string): string {
  if (!text.startsWith(SPECIALIST_ENDED_LEAD)) return text;
  const end = text.indexOf(COORDINATOR_ONLY);
  if (end === -1) return text;
  // A person may type the same lead; only the hub's own notice lines are cut.
  return NOTICE_LINES.has(text.slice(SPECIALIST_ENDED_LEAD.length, end))
    ? text.slice(0, end)
    : text;
}
