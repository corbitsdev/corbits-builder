import { fixedTools, type FixedTool } from "@corbits-builder/plugin/tools";
import { provisionDeps } from "./deps.ts";
import { createServer, type Deps } from "./provision.ts";
import { CREDENTIAL } from "./target.ts";

const TOOLS: Record<string, FixedTool<Deps>> = {
  digitalocean_create: {
    description:
      "Make the server the person agreed to on the Publish to DigitalOcean screen, in their DigitalOcean account, and wait until Builder's key works on it; or say it is up already. It checks the price and the team that pays are still what the person agreed to, records that something billed exists before it asks DigitalOcean, and deletes a server that does not come up in time. It never makes a second server for one that is gone. Can take several minutes. Returns { ok: true, address, made } or { ok: false, code }.",
    run: createServer,
  },
};

// The create action's agent gets only this tool, so it can make the server but not publish or
// remove. The host private key it makes exists only inside one call.
export default fixedTools<Deps>({
  id: "@corbits-builder/digitalocean/create-tools",
  credentials: [CREDENTIAL],
  tools: TOOLS,
  deps: provisionDeps,
});
