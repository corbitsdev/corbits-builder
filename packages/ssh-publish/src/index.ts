// Shared by every target that publishes a saved app to a machine over SSH, whoever owns the
// machine. A vendor plugin supplies the target handle, the ssh credential and the wording.
export { status, unpublish, type Deps } from "./release.ts";
export { sshReleaseDeps, sshReleaseTools } from "./deps.ts";
