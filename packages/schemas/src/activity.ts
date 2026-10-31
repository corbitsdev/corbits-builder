import { type } from "arktype";
import { WorkflowRole } from "./roles.ts";

// A tool call as the run's native tool.start event named it: the tool and its one identifying
// argument (a path, a skill, a command), never the whole argument object.
export const ActivityTool = type({
  "+": "reject",
  name: "string > 0",
  "subject?": "string > 0",
  running: "boolean",
  at: "string > 0",
});
export type ActivityTool = typeof ActivityTool.infer;

// A run at work in the project, with what its own inference events last showed. A run the hub
// has seen no event from since the hub started has no tools and no text.
export const AgentActivity = type({
  "+": "reject",
  runId: "string > 0",
  role: WorkflowRole,
  since: "string > 0",
  tools: ActivityTool.array().atMostLength(3),
  "said?": "string > 0",
});
export type AgentActivity = typeof AgentActivity.infer;

export const ProjectActivity = type({
  "+": "reject",
  agents: AgentActivity.array(),
});
export type ProjectActivity = typeof ProjectActivity.infer;
