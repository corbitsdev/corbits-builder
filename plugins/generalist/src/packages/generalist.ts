import { mcpTools } from "@corbits/mcp/interchange/client";
import { createDocumentWriterArtifactTools } from "@corbits-builder/hub/artifacts/tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { savedResultTools } from "@corbits-builder/hub/workflows/saved-result-tools";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { createWriterWorkflow } from "@corbits-builder/writer/workflow";
import { createGeneralistAgent } from "../agent.ts";

const compacting = compactingDirector(nativePackageName("generalist"));

// It runs as a writer: the writer's model, and the document writer's tools, which file any kind.
const { source, contextWindow, timeouts, parameters } = roleInference("writer");
// The coder's web lookup: Exa's remote MCP server, keyless, its read-only tools without an ask.
const web = await mcpTools({
  servers: [{ name: "exa", url: "https://mcp.exa.ai/mcp" }],
  allowWithoutAsk: ["exa.web_search_exa", "exa.web_fetch_exa"],
});
const agent = createGeneralistAgent({
  // No fileBeforeDone: a question files nothing, and its reply is the answer.
  director: compacting.build({ contextWindow, timeouts, compactAt: 0.6 }),
  inference: { ...source, parameters },
  tools: [createDocumentWriterArtifactTools(), web, savedResultTools],
});
const workflow = createWriterWorkflow({
  id: "corbits-builder-generalist",
  address: "generalist",
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
