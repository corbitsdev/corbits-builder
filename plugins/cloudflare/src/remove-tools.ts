import { fixedTools, type FixedTool } from "@corbits-builder/plugin/tools";
import { unpublish, type Deps } from "./cloudflare.ts";
import { cloudflareDeps } from "./deps.ts";
import { CREDENTIAL } from "./target.ts";
import { STATUS } from "./tools.ts";

const TOOLS: Record<string, FixedTool<Deps>> = {
  cloudflare_unpublish: {
    description:
      "Take the app down from Cloudflare with the person's saved key, keeping its database, and clear the release recorded for it. It acts only on the person's go-ahead on the take-down screen for what is published now. An app in a temporary account cannot be taken down this way. Returns { ok: true, databaseKept } or { ok: false, code }.",
    run: unpublish,
  },
  cloudflare_status: STATUS,
};

// The remove action's agent gets only these tools. It can take the app down and check the address
// but cannot publish, so a removal the person agreed to cannot turn into a release.

export default fixedTools<Deps>({
  id: "@corbits-builder/cloudflare/remove-tools",
  credentials: [CREDENTIAL],
  tools: TOOLS,
  deps: cloudflareDeps,
});
