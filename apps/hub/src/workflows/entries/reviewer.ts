import { createReviewerAgent } from "@corbits-builder/reviewer/agent";
import { createReviewerWorkflow } from "@corbits-builder/reviewer";
import { mail } from "@intx/tools-mail/sidecar-bundle";
import { roleInference } from "../role-inference.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "../compaction.ts";
import { nativePackageName } from "../package-name.ts";

const compacting = compactingDirector(nativePackageName("reviewer"));

const { source, contextWindow, parameters } = roleInference("reviewer");
const agent = createReviewerAgent({
  director: compacting.build({
    contextWindow,
    compactAt: 0.6,
  }),
  id: "reviewer",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [mail],
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
