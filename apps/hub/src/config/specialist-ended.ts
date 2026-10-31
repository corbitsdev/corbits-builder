import type { SpawnedRole } from "@corbits-builder/schemas/installed-workflows";

// The hub's mail to a coordinator whose specialist stopped before it delivered its result. It
// reaches the coordinator as the person's message. The fixed lead and the plain first paragraph are
// what the person sees, as a quiet line rather than as words they typed; the paragraph after it is
// for the coordinator only and quotes the recorded reason as Interchange gave it.
export const SPECIALIST_ENDED_LEAD = "Status update: ";

const COORDINATOR_ONLY = "\n\n";

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
};

const TASKS: Record<SpawnedRole, (kind: string | undefined) => string> = {
  writer: (kind) => `The writer writing the ${kind ?? "assigned"} document`,
  reviewer: (kind) =>
    `The reviewer checking the ${kind ?? "assigned"} document`,
  coder: () => "The coder building the app",
  designer: () => "The designer working on the app's design",
};

export function specialistEndedMessage(ended: {
  role: SpawnedRole;
  kind?: string;
  status: Outcome;
  reason?: { message: string; code?: string };
}): string {
  const how = ended.status === "failed" ? "failed" : "was stopped";
  const reason = ended.reason
    ? ` Recorded reason${ended.reason.code ? ` (${ended.reason.code})` : ""}: ${ended.reason.message}`
    : "";
  return `${SPECIALIST_ENDED_LEAD}${PERSON_LINES[ended.role][ended.status]}${COORDINATOR_ONLY}${TASKS[ended.role](ended.kind)} ${how} before finishing, so no result is coming from it.${reason}`;
}

/** A person-sent turn as the person may read it: a specialist-ended notice loses its coordinator-only part. */
export function personTurnText(text: string): string {
  if (!text.startsWith(SPECIALIST_ENDED_LEAD)) return text;
  const end = text.indexOf(COORDINATOR_ONLY);
  return end === -1 ? text : text.slice(0, end);
}
