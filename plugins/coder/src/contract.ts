// The filed documents a coder works from, read-only in its workspace.
export const CODER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;

// A coder started from the person's words alone: a change to an imported app whose project has filed
// no documents and no design. A first build always has documents, as its manifest requires.
export const NO_DOCUMENTS_NOTE =
  "The project has no documents and no design yet, so there is no build plan and no .builder folder: the instruction below is your whole assignment. Build or change only what it asks; where it leaves something open, choose what suits the app best and say what you chose in your reply. Use the starter's @corbits/react-ui theme for the look. Write ACCEPTANCE.md from what the instruction asks.\n\n";

// A later change starts a fresh coder on the saved app, so its assignment says so after the documents.
export const APP_CHANGE_NOTE =
  "The app is already built: your workspace holds it as last saved. This is a change to it, not a new build.\n\n";

// The documents themselves are staged read-only in the workspace; the message carries the task.
export function coderTaskMessage(task: string | undefined): string {
  return task?.trim() || "Build the app these documents describe.";
}
