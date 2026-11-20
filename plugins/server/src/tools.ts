import type { FixedTool } from "@corbits-builder/plugin/tools";
import {
  sshReleaseTools,
  status,
  type Deps,
} from "@corbits-builder/ssh-publish";
import { SERVER_CREDENTIAL, TARGET } from "./target.ts";

/** The status tool, which both the publish agent and the remove action's agent get. */
export const STATUS: FixedTool<Deps> = {
  description:
    "Say whether the app is published on the server, running and answering. Returns { ok: true, state, ... } or { ok: false, code }.",
  run: status,
};

// Each tool runs a fixed script on the person's server with the credential they saved for it, and
// returns only a fixed code and a few typed fields to the agent, never what the server printed. The
// publish agent cannot take the app down. The remove action runs a separate agent for that, which
// starts only once the person agreed on the take-down screen.
export default sshReleaseTools({
  id: "@corbits-builder/server/tools",
  target: TARGET,
  credential: SERVER_CREDENTIAL,
  release: {
    name: "server_release",
    description:
      "Publish the project's saved app to the person's server: look at the server, ready it for this app when it is not, then put the new version in place keeping what people entered, and record the release once the new version runs there. The release is recorded in the project by this call itself. Returns { ok: true, url } or { ok: false, code }.",
  },
  status: { name: "server_status", description: STATUS.description },
});
