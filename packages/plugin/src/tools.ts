import type { AnnotatedToolFactory } from "@intx/agent/authoring";

// The tools a plugin's agent brings beside the hub's, each made with defineTool, given the name of
// the role the agent plays. Apart from index.ts, so an interface that reads manifests never loads
// the agent framework.
export type AgentTools = (host: { role: string }) => AnnotatedToolFactory[];

export const defineTools = (tools: AgentTools) => tools;
