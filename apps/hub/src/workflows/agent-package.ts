// The workflow package of an agent a plugin declares in its manifest: one agent step, its prompt and
// the role it plays, which build-packages.ts inlines with what the actions that start it name and
// the workspace it declares, and, for a workspace with a browser, the browser's tools.
import { mcpTools } from "@corbits/mcp/interchange/client";
import { credentialProvider, ROLE_TAG } from "@corbits-builder/plugin";
import type { AgentTools, ToolEnv } from "@corbits-builder/plugin/tools";
import { AgentPackage } from "@corbits-builder/plugin-host/catalog";
import {
  defineAgent,
  toolFactoryMeta,
  type AnnotatedToolFactory,
} from "@intx/agent/authoring";
import type { CredentialBinding, GrantRequirement } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { defineWorkflow, step } from "@intx/workflow/definition";
import {
  createArtifactTools,
  createWriterArtifactTools,
} from "../artifacts/tools.ts";
import { CHECK_DESIGN_TOOL } from "../builds/design-submission.ts";
import { toolFailure } from "./project-scope.ts";
import {
  BrowserTools,
  createSidecarCodingTools,
  FINISH_CHECK,
} from "../builds/sidecar-tools.ts";
import { createSkillTools } from "../skills/tools.ts";
import { createBlockedTools } from "./blocked.ts";
import { dropDegenerateTurn, trimHistory } from "./compaction.ts";
import { compactingDirector } from "./director.ts";
import { createInputFileTools } from "./input-file-tools.ts";
import { nativePackageName } from "./package-name.ts";
import { roleInference } from "./role-inference.ts";
import { savedResultTools } from "./saved-result-tools.ts";

// The host owns reporting unexpected plugin failures and returning their refusals to the agent.
function hostPluginTool(factory: AnnotatedToolFactory<ToolEnv>) {
  const wrapped = (env: ToolEnv) => {
    const bundle = factory(env);
    const run = bundle.run.bind(bundle);
    bundle.run = async (call, signal) => {
      try {
        return await run(call, signal);
      } catch (error) {
        return toolFailure(call.id, error, "tool_call_refused");
      }
    };
    return bundle;
  };
  return Object.assign(wrapped, toolFactoryMeta(factory));
}

// The longest writer step in stored runs took 276 s; ten minutes leaves room for a slower model.
const STEP_TIMEOUT_MS = 600_000;

const inlined = process.env.BUILDER_AGENT;
if (!inlined) throw new Error("agent_package_required");
const {
  name,
  prompt,
  role,
  skills,
  files,
  workspace,
  fileBeforeDone,
  presents,
  done,
  credentials,
} = AgentPackage.assert(JSON.parse(inlined));
const { tools } = role;
const compacting = compactingDirector(nativePackageName(name));
const { source, contextWindow, timeouts, parameters } = roleInference(
  role.name,
);
if (!source.provider.trim() || !source.model.trim())
  throw new Error(`${name} requires an explicit provider and model`);
const works = workspace !== null;
let browser: BrowserTools | undefined;
if (workspace?.kind === "app" && workspace.browser) {
  const listed = process.env.BUILDER_BROWSER;
  if (!listed) throw new Error("browser_tools_required");
  browser = BrowserTools.assert(JSON.parse(listed));
}

const factories = [];
if (tools.includes("read_artifact") || tools.includes("write_artifact"))
  factories.push(
    files === null
      ? createArtifactTools(role)
      : createWriterArtifactTools(role, files),
  );
// Exa's remote MCP server, keyless, its read-only tools without an ask.
if (tools.includes("web"))
  factories.push(
    await mcpTools({
      servers: [{ name: "exa", url: "https://mcp.exa.ai/mcp" }],
      allowWithoutAsk: ["exa.web_search_exa", "exa.web_fetch_exa"],
    }),
  );
if (workspace?.kind === "app")
  factories.push(
    createSidecarCodingTools({
      role: role.name,
      approval: "allow",
      workspace: {
        kind: "app",
        commands: workspace.commands,
        commandModules: workspace.commandModules,
        pageWatcher: workspace.pageWatcher,
        kit: workspace.kit,
      },
      packageInstall: workspace.packageInstall,
      browser,
    }),
  );
if (workspace?.kind === "design")
  factories.push(
    createSidecarCodingTools({
      role: role.name,
      approval: "allow",
      workspace,
    }),
  );
if (Object.keys(skills).length > 0) factories.push(createSkillTools(skills));
// A trimmed result's note names read_file, so every agent has it: its input files' or its
// workspace's, else one that reads only saved results.
if (tools.includes("input_files"))
  factories.push(createInputFileTools(role.name));
else if (!works) factories.push(savedResultTools);
factories.push(createBlockedTools(role.name));
// Deploy binds the hub's own handle itself.
const credentialBindings: CredentialBinding[] = [];
// build-packages.ts defines the path, so the bundler inlines the plugin's tools module here.
if (process.env.BUILDER_TOOLS !== undefined) {
  const brought: AgentTools = (await import(process.env.BUILDER_TOOLS)).default;
  for (const factory of brought({ role: role.name }).map(hostPluginTool)) {
    factories.push(factory);
    for (const { handle } of factory.credentials ?? []) {
      if (handle === HUB_CREDENTIAL_HANDLE) continue;
      if (!credentials.includes(handle))
        throw new Error(
          `plugin_tool_credential_undeclared: ${factory.id} ${handle}`,
        );
      credentialBindings.push({
        package: factory.id,
        handle,
        provider: credentialProvider(handle),
        locator: "tenant",
      });
    }
  }
}
// A reply waits for its workspace's finish check: check-stack in an app, check_design in a mockup.
let checkBeforeDone: string | null = null;
if (workspace?.kind === "app") checkBeforeDone = FINISH_CHECK;
if (workspace?.kind === "design") checkBeforeDone = CHECK_DESIGN_TOOL;

const agent = defineAgent({
  id: name,
  systemPrompt: prompt,
  tools: factories,
  director: compacting.build({
    contextWindow,
    timeouts,
    compactAt: 0.6,
    checkBeforeDone,
    fileBeforeDone,
    done,
    presents,
    asks: factories.flatMap((factory) =>
      factory.definitions
        .filter((definition) => definition.approval === "ask")
        .map((definition) => definition.name),
    ),
  }),
  capabilities: [],
  inference: { sources: [{ ...source, parameters }] },
  // The hub tells a specialist's run by its role's tag.
  tags: { [ROLE_TAG]: role.name },
});

// A run that files a document or reviews one is bounded; one that works in a workspace runs as
// long as its work does. No retry: a second attempt would redo work the first may already have filed.
const work = works
  ? step({
      agent,
      input: { from: "trigger.payload" },
      inference: { literal: parameters },
      drainBehavior: "wait",
      triggers: 1,
    })
  : step({
      agent,
      input: { from: "trigger.payload" },
      inference: { literal: parameters },
      drainBehavior: "wait",
      timeout: STEP_TIMEOUT_MS,
      triggers: 1,
    });

// A design run files design options, of which the one the person chooses becomes the design.
const grantRequirements: GrantRequirement[] = [
  { resource: "sb-project:*", action: "read", source: "invoker" },
];
const filed = workspace?.kind === "design" ? "design_option" : role.files;
if (filed !== undefined)
  grantRequirements.push({
    resource: `sb-artifact:${filed}`,
    action: "write",
    source: "invoker",
  });
else if (role.filesDocuments)
  grantRequirements.push({
    resource: "sb-artifact:*",
    action: "write",
    source: "invoker",
  });

export default defineWorkflow({
  id: `corbits-builder-${name}`,
  grantRequirements,
  credentialBindings,
  mailAccept: { invoker: true },
  triggers: [{ type: "mail", to: name }],
  // A workspace, or a tool that works in a folder, needs a POSIX sidecar to run in.
  sidecarPlacement: {
    capabilities:
      works || factories.some(({ requires }) => requires.includes("toolCwd"))
        ? [{ capability: "runtime:posix", effect: "require" }]
        : [],
  },
  steps: { work },
});
// The directors module of this package: the director the agent names and the compactors it uses.
export const director = compacting.factory;
export const historyCompactor = trimHistory(
  contextWindow - parameters.maxTokens,
);
export const degenerateTurnCompactor = dropDegenerateTurn;
