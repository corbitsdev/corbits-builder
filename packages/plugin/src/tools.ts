import type { AnnotatedToolFactory, BaseEnv } from "@intx/agent/authoring";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { ToolResult } from "@intx/types/runtime";

// The most a plugin's tool may require of its run: the folder it works in, which puts the run on a
// POSIX sidecar, and the run's capabilities.
export interface ToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

// The hub's report of a tool call that threw: its refusal as the model may read it, the cause
// logged where the hub keeps its logs.
export type ToolFailure = (callId: string, error: unknown) => ToolResult;

// The tools a plugin's agent brings beside the hub's, each made with defineTool, given the name of
// the role the agent plays and the hub's report of a failed call. Apart from index.ts, so an
// interface that reads manifests never loads the agent framework.
export type AgentTools = (host: {
  role: string;
  failure: ToolFailure;
}) => AnnotatedToolFactory<ToolEnv>[];

export const defineTools = (tools: AgentTools) => tools;
