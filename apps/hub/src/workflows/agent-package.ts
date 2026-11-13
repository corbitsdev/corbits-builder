// The workflow package of an agent a plugin declares in its manifest: one agent step, its prompt and
// the role it plays from the manifest, which build-packages.ts inlines: the role's tools and model.
import { mcpTools } from "@corbits/mcp/interchange/client";
import { AgentPackage, ROLE_TAG } from "@corbits-builder/plugin";
import { defineAgent } from "@intx/agent/authoring";
import { defineWorkflow, step } from "@intx/workflow/definition";
import { createArtifactTools } from "../artifacts/tools.ts";
import { createBlockedTools } from "./blocked.ts";
import { dropDegenerateTurn, trimHistory } from "./compaction.ts";
import { compactingDirector } from "./director.ts";
import { nativePackageName } from "./package-name.ts";
import { roleInference } from "./role-inference.ts";
import { savedResultTools } from "./saved-result-tools.ts";

// The longest writer step in stored runs took 276 s; ten minutes leaves room for a slower model.
const STEP_TIMEOUT_MS = 600_000;

const inlined = process.env.BUILDER_AGENT;
if (!inlined) throw new Error("agent_package_required");
const { name, prompt, role, fileBeforeDone } = AgentPackage.assert(
  JSON.parse(inlined),
);
const { tools } = role;
const compacting = compactingDirector(nativePackageName(name));
const { source, contextWindow, timeouts, parameters } = roleInference(
  role.name,
);
if (!source.provider.trim() || !source.model.trim())
  throw new Error(`${name} requires an explicit provider and model`);

const factories = [];
if (tools.includes("read_artifact") || tools.includes("write_artifact"))
  factories.push(createArtifactTools(role));
// Exa's remote MCP server, keyless, its read-only tools without an ask.
if (tools.includes("web"))
  factories.push(
    await mcpTools({
      servers: [{ name: "exa", url: "https://mcp.exa.ai/mcp" }],
      allowWithoutAsk: ["exa.web_search_exa", "exa.web_fetch_exa"],
    }),
  );
// A trimmed result's note names read_file, so every agent has it.
factories.push(savedResultTools);
factories.push(createBlockedTools(role.name));

const agent = defineAgent({
  id: name,
  systemPrompt: prompt,
  tools: factories,
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
    fileBeforeDone,
  }),
  capabilities: [],
  inference: { sources: [{ ...source, parameters }] },
  // The hub tells a specialist's run by its role's tag.
  tags: { [ROLE_TAG]: role.name },
});

export default defineWorkflow({
  id: `corbits-builder-${name}`,
  grantRequirements: [
    { resource: "sb-project:*", action: "read", source: "invoker" },
    { resource: "sb-artifact:*", action: "write", source: "invoker" },
  ],
  mailAccept: { invoker: true },
  triggers: [{ type: "mail", to: name }],
  steps: {
    work: step({
      agent,
      input: { from: "trigger.payload" },
      inference: { literal: parameters },
      drainBehavior: "wait",
      // No retry: a second attempt would redo work the first may already have filed.
      timeout: STEP_TIMEOUT_MS,
      triggers: 1,
    }),
  },
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
