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

// What a long command a run is executing last said about itself: a line in the person's words,
// such as "installing the app's packages" or "checking the mockup: page 7 of 18", and when. The
// sandbox writes it beside the run's workspace while the command runs and removes it after, and
// the hub reads it from a sidecar on its own machine.
export const COMMAND_PROGRESS_FILE = "command-progress.json";
export const CommandProgress = type({
  "+": "reject",
  line: "string > 0",
  at: "string > 0",
});
export type CommandProgress = typeof CommandProgress.infer;

// A run at work in the project, with what its own inference events last showed. A run the hub
// has seen no event from since the hub started has no tools and no text.
export const AgentActivity = type({
  "+": "reject",
  runId: "string > 0",
  role: WorkflowRole,
  since: "string > 0",
  tools: ActivityTool.array().atMostLength(3),
  "said?": "string > 0",
  "command?": CommandProgress,
});
export type AgentActivity = typeof AgentActivity.infer;

export const ProjectActivity = type({
  "+": "reject",
  agents: AgentActivity.array(),
});
export type ProjectActivity = typeof ProjectActivity.infer;
