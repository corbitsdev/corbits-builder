// Shared by every target that publishes a saved app to a machine over SSH, whoever owns the
// machine. A target plugin supplies its handle, the ssh credential and the wording. This
// entry imports Node modules, so only a plugin's tools import it, never an action definition.
export { status, unpublish, type Deps } from "./release.ts";
export { sshReleaseDeps, sshReleaseTools } from "./deps.ts";
