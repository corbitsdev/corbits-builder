import { type } from "arktype";
import { RoleName } from "./roles.ts";

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
  role: RoleName,
  since: "string > 0",
  tools: ActivityTool.array().atMostLength(3),
  "said?": "string > 0",
  "command?": CommandProgress,
});
export type AgentActivity = typeof AgentActivity.infer;

// A call a run made, as the run's saved conversation keeps it: the tool, the arguments it was
// given, when the turn that made it was saved, and its result's text, the end of it when long,
// once the result came back.
export const RunStep = type({
  "+": "reject",
  callId: "string > 0",
  name: "string > 0",
  arguments: "Record<string, unknown>",
  at: "number",
  "result?": { "+": "reject", content: "string", isError: "boolean" },
});
export type RunStep = typeof RunStep.infer;

// What stopped a specialist run it could not get past, in its own words or Builder's: what stops the
// work and what was tried.
export const RunBlock = type({
  "+": "reject",
  reason: "0 < string <= 2000",
  tried: "0 < string <= 2000",
});
export type RunBlock = typeof RunBlock.infer;

// Every call a run made, in the order it made them, and the run's status as Interchange reports
// it, with why when it failed and what blocked it when it was blocked.
export const RunSteps = type({
  "+": "reject",
  status: "string > 0",
  "error?": "string > 0",
  "blocked?": RunBlock,
  steps: RunStep.array(),
});
export type RunSteps = typeof RunSteps.infer;

export const ProjectActivity = type({
  "+": "reject",
  agents: AgentActivity.array(),
});
export type ProjectActivity = typeof ProjectActivity.infer;
