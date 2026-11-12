import { mail } from "@intx/tools-mail/sidecar-bundle";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { savedResultTools } from "@corbits-builder/hub/workflows/saved-result-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { createReviewerAgent } from "../reviewer/agent.ts";
import { createReviewerWorkflow } from "../reviewer/workflow.ts";

const compacting = compactingDirector(nativePackageName("reviewer"));

const { source, contextWindow, timeouts, parameters } =
  roleInference("reviewer");
const agent = createReviewerAgent({
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
  }),
  id: "reviewer",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [mail, savedResultTools],
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
