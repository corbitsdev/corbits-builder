import manifest from "../package.json";

// The filed documents a coder works from, read-only in its workspace when the project has them.
export const CODER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;

// What a first build can start from, by name, as the manifest declares each.
export const STARTERS = manifest.builder.appStarters;
type StarterName = keyof typeof STARTERS;

const isStarterName = (name: unknown): name is StarterName =>
  typeof name === "string" && Object.hasOwn(STARTERS, name);

export const STARTER_NAMES = Object.keys(STARTERS).filter(isStarterName);

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
