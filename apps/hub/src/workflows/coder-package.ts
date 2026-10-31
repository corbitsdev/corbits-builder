import { createCoderAgent } from "@corbits-builder/coder/agent";
import { createCoderWorkflow } from "@corbits-builder/coder";
import {
  createSidecarCodingTools,
  type CodingSidecarEnv,
} from "../builds/sidecar-tools.ts";
import { browserCatalog } from "../builds/browser-catalog.ts" with { type: "macro" };
import { mcpTools } from "@corbits/mcp/interchange/client";
import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import { createArtifactTools } from "../artifacts/tools.ts";
import { createSkillTools } from "../skills/tools.ts";
import { roleInference } from "./role-inference.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "./compaction.ts";
import { nativePackageName } from "./package-name.ts";
import { DESIGN_STANDARD } from "../config/design.ts";
import { CODER_MCP } from "../config/mcp.ts";

/**
 * The coder's workflow package. `packageApproval` is frozen into the definition: "ask" declares
 * install_packages as an ask tool, "allow" declares it plain (AUTH.md, Grant Requirements on
 * Definitions; the definition hash differs, so each is its own approved definition).
 */
export async function coderPackage(
  name: string,
  packageApproval: "ask" | "allow",
) {
  const compacting = compactingDirector(nativePackageName(name));
  const { source, contextWindow, parameters } = roleInference("coder");
  // Discovered at load so the frozen definition carries the remote tool names.
  const web = await mcpTools(CODER_MCP);
  // The deployment starts its own browser on first use, so its tools are listed when the bundle is built.
  const browser = await browserCatalog();
  const agent = createCoderAgent<CodingSidecarEnv & MailToolEnv>({
    director: compacting.build({
      contextWindow,
      compactAt: 0.6,
      checkBeforeDone: true,
    }),
    id: "coder",
    capabilities: [],
    standards: [DESIGN_STANDARD],
    inference: { ...source, parameters },
    // The project role child supplies the sandboxed workspace and executor.
    tools: [
      createArtifactTools("coder"),
      mail,
      createSkillTools(["react-ui", "stack-docs"]),
      web,
      createSidecarCodingTools({
        approval: "allow",
        workspace: "app",
        packageInstall: packageApproval,
        browser,
      }),
    ],
  });
  return {
    workflow: createCoderWorkflow({
      id: "corbits-builder-" + name,
      address: "coder",
      agent,
      inference: { literal: parameters },
      grantRequirements: [
        { resource: "sb-project:*", action: "read", source: "invoker" },
        { resource: "sb-artifact:app", action: "write", source: "invoker" },
      ],
    }),
    // The directors module of this package: the director the agent names and the compactors it uses.
    director: compacting.factory,
    historyCompactor: trimHistory(contextWindow - parameters.maxTokens),
    degenerateTurnCompactor: dropDegenerateTurn,
  };
}
