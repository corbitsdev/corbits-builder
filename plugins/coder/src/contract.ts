// The documents themselves are staged read-only in the workspace; the message carries the task.
export function coderTaskMessage(task: string | undefined): string {
  return task?.trim() || "Build the app these documents describe.";
}
