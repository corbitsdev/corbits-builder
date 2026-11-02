import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";

// What the person reads about where their project stands and what they do next.
const ROLE: Record<WorkflowRole, string> = {
  coordinator: "the coordinator",
  writer: "a writer",
  reviewer: "a reviewer",
  designer: "the designer",
  coder: "the app builder",
  presenter: "the presenter",
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: readonly string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`;

const APPROVAL: Record<string, string> = {
  instruct_coder: "Approve the change for the app builder",
  design_app: "Approve the design work",
  install_packages: "Approve the packages the app builder asked for",
};

export const projectStatusWording = {
  archived: "This project is archived.",
  working: (roles: readonly WorkflowRole[]) =>
    roles.length === 0
      ? "Nobody is working."
      : `${capital(list(roles.map((role) => ROLE[role])))} ${roles.length === 1 ? "is" : "are"} working.`,
  starting: (role: WorkflowRole) => `${capital(ROLE[role])} is starting.`,
  unknown: (role: WorkflowRole) =>
    `Whether ${ROLE[role]} is working is unknown: its history could not be read.`,
  app: {
    not_started: "No app yet.",
    starting: "The app is starting.",
    running: "The app is running.",
    stopped: "The app is stopped.",
    failed: (reason: string | undefined) =>
      reason === undefined
        ? "The app is not running."
        : `The app is not running: ${reason}`,
    unavailable: "This Builder cannot run apps.",
  },
  saved: (version: number | undefined) =>
    version === undefined
      ? "It is not saved yet."
      : `Saved as version ${String(version)}.`,
  approval: (tool: string, kinds: readonly string[]) =>
    tool === "request_approval" && kinds.length > 0
      ? `Approve the ${list(kinds.map((kind) => kind.replaceAll("_", " ")))}`
      : (APPROVAL[tool] ?? "Decide on the open approval"),
  stopped: (role: WorkflowRole, reason: string | undefined) =>
    `${capital(ROLE[role])} stopped${reason === undefined ? "." : `: ${reason}`}`,
  next: {
    archived: "Restore the project to work on it",
    resumeCoordinator: "Start the coordinator again",
    wait: (role: WorkflowRole) =>
      role === "coordinator"
        ? "Wait for the coordinator's reply"
        : `Wait for ${ROLE[role]} to finish`,
    unknown: "Ask the coordinator where things stand",
    retry: "Ask the coordinator to try again",
    fixApp: "Ask the coordinator to fix the app",
    waitApp: "Wait for the app to start",
    tryApp: "Try the app, then ask for any changes",
    reply: "Reply to the coordinator",
  },
};
