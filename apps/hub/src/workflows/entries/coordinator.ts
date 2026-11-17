import { createCoordinatorAgent } from "@corbits-builder/coordinator/agent";
import { createCoordinatorWorkflow } from "@corbits-builder/coordinator";
import { createReadArtifactTools } from "../../artifacts/tools.ts";
import { createExecuteTools } from "../../plugins/tools.ts";
import { roleInference } from "../role-inference.ts";
import { compactingDirector } from "../director.ts";
import { dropDegenerateTurn, trimHistory } from "../compaction.ts";
import { savedResultTools } from "../saved-result-tools.ts";
import { nativePackageName } from "../package-name.ts";

const compacting = compactingDirector(nativePackageName("coordinator"));

const { source, contextWindow, timeouts, parameters } =
  roleInference("coordinator");
const agent = createCoordinatorAgent({
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
    // The coordinator's run is the project's; nothing starts a failed one again.
    replyOnFailure: true,
  }),
  id: "coordinator",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [createReadArtifactTools(), createExecuteTools(), savedResultTools],
});
const workflow = createCoordinatorWorkflow({
  id: "corbits-builder-coordinator",
  address: "coordinator",
  agent,
  inference: { literal: parameters },
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
    { resource: "sb-project:*", action: "manage", source: "invoker" },
    { resource: "sb-artifact:*", action: "write", source: "invoker" },
    { resource: "workflow:*", action: "create", source: "invoker" },
  ],
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
export default workflow;
