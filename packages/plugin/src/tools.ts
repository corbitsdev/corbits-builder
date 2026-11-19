import type { AnnotatedToolFactory, BaseEnv } from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

// The most a plugin's tool may require of its run: the folder it works in, which puts the run on a
// POSIX sidecar, and the run's capabilities.
export interface ToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

// The tools a plugin's agent brings beside the hub's, each made with defineTool, given the name of
// the role the agent plays. Apart from index.ts, so an interface that reads manifests never loads
// the agent framework.
export type AgentTools = (host: {
  role: string;
}) => AnnotatedToolFactory<ToolEnv>[];

export const defineTools = (tools: AgentTools) => tools;

/**
 * The handles of the plugin's credentials that an agent's tools resolve, as their factories declare
 * them. It leaves out the run's hub credential, which every run has.
 */
export function toolCredentials(tools: AgentTools, role: string): string[] {
  const handles = tools({ role }).flatMap((factory) =>
    (factory.credentials ?? []).map(({ handle }) => handle),
  );
  return [...new Set(handles)].filter(
    (handle) => handle !== HUB_CREDENTIAL_HANDLE,
  );
}
