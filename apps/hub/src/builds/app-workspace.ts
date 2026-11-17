import { readdir } from "node:fs/promises";
import { holdsApp } from "@corbits-builder/schemas/app-files";
import { INPUTS_DIRECTORY } from "../config/inputs.ts";

export const linkOrGone = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ELOOP" || error.code === "ENOENT");

// The hub unpacks the design and the run's inputs into the workspace before the app is seeded, so
// they are not the app.
const HUB_DIRECTORIES = new Set([".builder", INPUTS_DIRECTORY]);

/** Whether a workspace holds an app yet; one not made yet holds none. */
export async function workspaceHoldsApp(workspace: string) {
  try {
    const entries = await readdir(workspace);
    return holdsApp(entries.filter((entry) => !HUB_DIRECTORIES.has(entry)));
  } catch (error) {
    if (linkOrGone(error)) return false;
    throw error;
  }
}
