import { fixedTools, type FixedTool } from "@corbits-builder/plugin/tools";
import { provisionDeps } from "./deps.ts";
import { removeServer, serverStatus, type Deps } from "./provision.ts";
import { CREDENTIAL } from "./target.ts";

const REMOVE_TOOLS: Record<string, FixedTool<Deps>> = {
  digitalocean_destroy: {
    description:
      "Delete the server Builder made at DigitalOcean, with the app and everything people entered in it, so DigitalOcean stops charging for it; then forget its key and clear what the project recorded of it and of the server the person chose. It acts only on the person's go-ahead on the take-down screen for what is published or held there now, and only the server Builder made, at the address Builder knows, is deleted. Returns { ok: true } or { ok: false, code }.",
    run: removeServer,
  },
  digitalocean_server_status: {
    description:
      "Say whether DigitalOcean still has the server Builder made: state none, starting, running or off, with its address. Returns { ok: true, state, address? } or { ok: false, code }.",
    run: serverStatus,
  },
};

// The remove action's agent gets only these tools, so it can delete the server and check on it but
// cannot make a server or publish. A removal the person agreed to never turns into either.
export default fixedTools<Deps>({
  id: "@corbits-builder/digitalocean/remove-tools",
  credentials: [CREDENTIAL],
  tools: REMOVE_TOOLS,
  deps: provisionDeps,
});
