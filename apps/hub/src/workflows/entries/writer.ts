import { createWriterAgent } from "@corbits-builder/writer/agent";
import { createWriterWorkflow } from "@corbits-builder/writer";
import { createArtifactTools } from "@corbits-builder/tools-artifacts/sidecar-bundle";
import { failure } from "../../artifacts/tools.ts";
import { createSkillTools } from "../../skills/tools.ts";
import { roleInference } from "../role-inference.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "../compaction.ts";
import { nativePackageName } from "../package-name.ts";

const compacting = compactingDirector(nativePackageName("writer"));

const { source, contextWindow, parameters } = roleInference("writer");
const agent = createWriterAgent({
  director: compacting.build({
    contextWindow,
    compactAt: 0.6,
    fileBeforeDone: true,
  }),
  id: "document-writer",
  capabilities: [],
  inference: { ...source, parameters },
  tools: [
    createArtifactTools("writer", { failure }),
    createSkillTools([
      "constraints",
      "approaches",
      "product-requirements",
      "build-plan",
    ]),
  ],
});
const workflow = createWriterWorkflow({
  id: "corbits-builder-writer",
  address: "writer",
  agent,
  inference: { literal: parameters },
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
    { resource: "sb-artifact:*", action: "write", source: "invoker" },
  ],
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
export default workflow;
