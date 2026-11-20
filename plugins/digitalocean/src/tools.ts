import { sshReleaseTools } from "@corbits-builder/ssh-publish";
import { SERVER_CREDENTIAL, TARGET } from "./target.ts";

// Each tool runs a fixed script on the server with the key the hub made for it, and returns only a
// fixed code and a few typed fields to the agent. The publish agent cannot make or remove the
// server; the create and remove actions run separate agents for that.
export default sshReleaseTools({
  id: "@corbits-builder/digitalocean/tools",
  target: TARGET,
  credential: SERVER_CREDENTIAL,
  release: {
    name: "digitalocean_release",
    description:
      "Publish the project's saved app to the person's server at DigitalOcean: ready the server for this app when it is not, then put the new version in place keeping what people entered, and record the release once the new version runs there. The release is recorded in the project by this call itself. Returns { ok: true, url } or { ok: false, code }.",
  },
  status: {
    name: "digitalocean_status",
    description:
      "Say whether the app is published on the server at DigitalOcean, running and answering. Returns { ok: true, state, ... } or { ok: false, code }.",
  },
});
