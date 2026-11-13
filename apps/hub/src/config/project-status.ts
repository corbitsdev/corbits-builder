import { runRole } from "../plugins/catalog.ts";
import { COORDINATOR } from "../workflows/coordinator-role.ts";

// What the person reads about where their project stands and what they do next, each role named
// by its label.
const who = (name: string) => `the ${runRole(name).label.toLowerCase()}`;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: readonly string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`;

const APPROVAL: Record<string, string> = {
  install_packages: "Approve the packages the coder asked for",
};

export const projectStatusWording = {
  archived: "This project is archived.",
  working: (roles: readonly string[]) =>
    roles.length === 0
      ? "Nobody is working."
      : `${capital(list(roles.map(who)))} ${roles.length === 1 ? "is" : "are"} working.`,
  starting: (role: string) => `${capital(who(role))} is starting.`,
  unknown: (role: string) =>
    `Whether ${who(role)} is working is unknown: its history could not be read.`,
  app: {
    not_started: "Nothing is running yet.",
    starting: "The app is starting.",
    running: "The app is running.",
    stopped: "The app is stopped.",
    failed: (reason: string | undefined) =>
      reason === undefined
        ? "The app is not running."
        : `The app is not running: ${reason}`,
    unavailable: "This Builder does not run what it builds.",
  },
  saved: (version: number | undefined) =>
    version === undefined
      ? "It is not saved yet."
      : `Saved as version ${String(version)}.`,
  approval: (tool: string) => APPROVAL[tool] ?? "Decide on the open approval",
  stopped: (role: string, reason: string | undefined) =>
    `${capital(who(role))} stopped${reason === undefined ? "." : `: ${reason}`}`,
  next: {
    archived: "Restore the project to work on it",
    resumeCoordinator: "Start the coordinator again",
    wait: (role: string) =>
      role === COORDINATOR.name
        ? "Wait for the coordinator's reply"
        : `Wait for ${who(role)} to finish`,
    unknown: "Ask the coordinator where things stand",
    retry: "Ask the coordinator to try again",
    fixApp: "Ask the coordinator to fix the app",
    waitApp: "Wait for the app to start",
    tryApp: "Try the app, then ask for any changes",
    reply: "Reply to the coordinator",
  },
};
