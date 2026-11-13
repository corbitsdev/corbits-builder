import {
  createSidecarCodingTools,
  type CodingSidecarEnv,
} from "@corbits-builder/hub/builds/sidecar-tools";
import { browserCatalog } from "@corbits-builder/hub/builds/browser-catalog" with { type: "macro" };
import {
  mcpTools,
  type McpToolsOptions,
} from "@corbits/mcp/interchange/client";
import { mail, type MailToolEnv } from "@intx/tools-mail/sidecar-bundle";
import { createArtifactTools } from "@corbits-builder/hub/artifacts/tools";
import { roleInference } from "@corbits-builder/hub/workflows/role-inference";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { nativePackageName } from "@corbits-builder/hub/workflows/package-name";
import { declaredRole } from "@corbits-builder/plugin";
import manifest from "../package.json";
import {
  checkModules,
  checkScripts,
  kitDigest,
  watchScript,
} from "./assets.ts" with { type: "macro" };
import { createCoderAgent } from "./agent.ts";
import { createCoderWorkflow } from "./workflow.ts";

// Build and change both start this one workflow, and a run is not told which action started it, so
// a finished reply waits on every check either action's done names.
const DONE = {
  plugin: manifest.builder.handle,
  checks: [
    ...new Set(
      Object.values(manifest.builder.actions).flatMap((action) =>
        "done" in action ? action.done : [],
      ),
    ),
  ],
};

// Remote MCP servers the coder calls from its own deployment. Exa answers keyless, so no credential
// handle. Only its read-only tools run without a person's approval.
const CODER_MCP: McpToolsOptions = {
  servers: [{ name: "exa", url: "https://mcp.exa.ai/mcp" }],
  allowWithoutAsk: ["exa.web_search_exa", "exa.web_fetch_exa"],
};

/**
 * The coder's workflow package, the same for every project: what the project's code is, and
 * whether it serves a web app to try, the hub tells its workspace when the run starts.
 * install_packages asks the person before it installs.
 */
export async function coderPackage() {
  const role = declaredRole(manifest.builder);
  const compacting = compactingDirector(nativePackageName("coder"));
  const { source, contextWindow, timeouts, parameters } = roleInference(
    role.name,
  );
  // Discovered at load so the frozen definition carries the remote tool names.
  const search = await mcpTools(CODER_MCP);
  // The deployment starts its own browser on first use, so its tools are listed when the bundle is built.
  const browser = await browserCatalog();
  // The project role child supplies the sandboxed workspace and executor.
  const tools = [
    createArtifactTools(role),
    mail,
    search,
    createSidecarCodingTools({
      role: role.name,
      approval: "allow",
      workspace: {
        kind: "app",
        commands: checkScripts(),
        commandModules: checkModules(),
        pageWatcher: watchScript(),
        kit: kitDigest(),
      },
      packageInstall: "ask",
      browser,
    }),
  ];
  const agent = createCoderAgent<CodingSidecarEnv & MailToolEnv>({
    director: compacting.build({
      contextWindow,
      timeouts,
      compactAt: 0.6,
      checkBeforeDone: true,
      done: DONE,
      asks: tools.flatMap((tool) =>
        tool.definitions
          .filter((definition) => definition.approval === "ask")
          .map((definition) => definition.name),
      ),
    }),
    id: "coder",
    role: role.name,
    capabilities: [],
    inference: { ...source, parameters },
    tools,
  });
  return {
    workflow: createCoderWorkflow({
      id: "corbits-builder-coder",
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
