import { fixedTools, type FixedTool } from "@corbits-builder/plugin/tools";
import {
  sshReleaseDeps,
  unpublish,
  type Deps,
} from "@corbits-builder/ssh-publish";
import { SERVER_CREDENTIAL, TARGET } from "./target.ts";
import { STATUS } from "./tools.ts";

const REMOVE_TOOLS: Record<string, FixedTool<Deps>> = {
  server_unpublish: {
    description:
      "Take the app down: stop it and keep it from starting again, keeping what people entered, and clear the release recorded for this server. Returns { ok: true } or { ok: false, code }.",
    run: (deps) => unpublish(TARGET, deps),
  },
  server_status: STATUS,
};

// The remove action's agent gets only these tools, so it can take the app down and check on it but
// cannot publish. A removal the person agreed to never turns into a release.
export default fixedTools<Deps>({
  id: "@corbits-builder/server/remove-tools",
  credentials: [SERVER_CREDENTIAL],
  tools: REMOVE_TOOLS,
  deps: sshReleaseDeps(SERVER_CREDENTIAL),
});
