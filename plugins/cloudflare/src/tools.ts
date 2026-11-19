import { fixedTools, type FixedTool } from "@corbits-builder/plugin/tools";
import { release, status, type Deps } from "./cloudflare.ts";
import { cloudflareDeps } from "./deps.ts";
import { CREDENTIAL } from "./target.ts";

/**
 * Checks the published address. Both the publisher's agent and the remove action's agent have it.
 */
export const STATUS: FixedTool<Deps> = {
  description:
    "Say whether the address the app was last published at on Cloudflare answers people now. Returns { ok: true, state, url? } or { ok: false, code }.",
  run: status,
};

const TOOLS: Record<string, FixedTool<Deps>> = {
  cloudflare_release: {
    description:
      "Publish the project's saved app to Cloudflare: build it, ready its database, upload it, record the publish in the project, then wait until its address answers. Goes to the person's own Cloudflare account through their saved key, or else makes one temporary Cloudflare account, which needs the person's acceptance of Cloudflare's terms each time. Returns { ok: true, url } (with keepWithinMinutes for a temporary account) or { ok: false, code }.",
    run: release,
  },
  cloudflare_status: STATUS,
};

// Each tool runs a fixed, tested step against Cloudflare's API and returns only a code and a few
// typed fields to the agent: never a token, a link to keep the app, or anything Cloudflare wrote.
// The publisher's agent cannot take the app down. Only the remove action's agent can, and it starts
// only after the person agreed on the take-down screen.

export default fixedTools<Deps>({
  id: "@corbits-builder/cloudflare/tools",
  credentials: [CREDENTIAL],
  tools: TOOLS,
  deps: cloudflareDeps,
});
