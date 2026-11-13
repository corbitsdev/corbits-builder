import manifest from "../package.json";

// The filed documents a coder works from, read-only in its workspace when the project has them.
export const CODER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;

// What a first build can start from, by name: the folder of files the hub writes onto the
// project's repository before the coder starts, whether that code serves a web app, the command
// that prepares a fresh workspace, what an agent can do when that command fails, and the commands
// the hub saves as the project's stack.checks.
export const STARTERS = manifest.coder.starters;
export type StarterName = keyof typeof STARTERS;

export const isStarterName = (name: unknown): name is StarterName =>
  typeof name === "string" && Object.hasOwn(STARTERS, name);

export const STARTER_NAMES = Object.keys(STARTERS).filter(isStarterName);

/**
 * What code that began from a starter declares of itself, by the project's stack.starter: the
 * command that prepares a fresh workspace, what to do when it fails, and whether it serves a web
 * app. Code that began from none declares nothing.
 */
export function declaredStack(starter: unknown) {
  if (!isStarterName(starter)) return undefined;
  const { setup, setupFailed, serves } = STARTERS[starter];
  return { setup, setupFailed, serves };
}

// A coder started from the person's words alone: a change to an imported project that has filed no
// documents. A first build always has documents, as its manifest requires.
export const NO_DOCUMENTS_NOTE =
  "The project has no documents filed yet: the instruction below is your whole assignment. Build or change only what it asks; where it leaves something open, choose what suits the project best and say what you chose in your reply. Write ACCEPTANCE.md from what the instruction asks.\n\n";

// A later change starts a fresh coder on the saved code, so its assignment says so after the documents.
export const APP_CHANGE_NOTE =
  "The project's code is already built: your workspace holds it as last saved. This is a change to it, not a new build.\n\n";

// The documents themselves are staged read-only in the workspace; the message carries the task.
export function coderTaskMessage(task: string | undefined): string {
  return task?.trim() || "Build what these documents describe.";
}
