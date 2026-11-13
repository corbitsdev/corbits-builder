import { mail } from "@intx/tools-mail/sidecar-bundle";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import { createBlockedTools } from "@corbits-builder/hub/workflows/blocked";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { savedResultTools } from "@corbits-builder/hub/workflows/saved-result-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { declaredRole } from "@corbits-builder/plugin";
import manifest from "../../package.json";
import { createReviewerAgent } from "../reviewer/agent.ts";
import { createReviewerWorkflow } from "../reviewer/workflow.ts";

const role = declaredRole(manifest.builder, "reviewer");
const compacting = compactingDirector(nativePackageName("reviewer"));

const { source, contextWindow, timeouts, parameters } = roleInference(
  role.name,
);
const agent = createReviewerAgent({
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
  }),
  id: "reviewer",
  role: role.name,
  capabilities: [],
  inference: { ...source, parameters },
  tools: [mail, savedResultTools, createBlockedTools(role.name)],
});
const workflow = createReviewerWorkflow({
  id: "corbits-builder-reviewer",
  address: "reviewer",
  agent,
  inference: { literal: parameters },
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
  ],
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
export default workflow;
