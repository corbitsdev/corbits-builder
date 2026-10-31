import { type } from "arktype";
import { WorkflowRole } from "./roles.ts";

// A live run by its latest committed event. idle: parked on input, waiting for mail. approval:
// parked on an approval, waiting on the person. starting: no address or no event yet. unknown: its
// event log could not be read.
export const RunState = type(
  "'working' | 'idle' | 'approval' | 'starting' | 'unknown'",
);
export type RunState = typeof RunState.infer;

export const LiveRunStates = type({
  "+": "reject",
  runs: type({
    "+": "reject",
    runId: "string > 0",
    role: WorkflowRole,
    state: RunState,
  }).array(),
});
export type LiveRunStates = typeof LiveRunStates.infer;

// A run at work or whose state cannot be told; none listed is nobody at work.
export const ProjectWorker = type({
  "+": "reject",
  role: WorkflowRole,
  state: "'working' | 'starting' | 'unknown'",
});
export type ProjectWorker = typeof ProjectWorker.infer;

const ProjectWaiting = type({
  "+": "reject",
  kind: "'approval'",
  approvalId: "string > 0",
  tool: "string > 0",
}).or({ "+": "reject", kind: "'reply'" });

export const ProjectAppStatus = type({
  "+": "reject",
  state:
    "'not_started' | 'starting' | 'running' | 'stopped' | 'failed' | 'unavailable'",
  "reason?": "string > 0",
  // The latest filed app version; absent while the app has never been saved.
  "savedVersion?": "number.integer > 0",
});
export type ProjectAppStatus = typeof ProjectAppStatus.infer;

// The person's actions a next step can name; each is an existing control in the workspace.
export const ProjectNextAction = type(
  "'open_app' | 'reply' | 'resume_coordinator'",
);
export type ProjectNextAction = typeof ProjectNextAction.infer;

export const ProjectStatus = type({
  "+": "reject",
  working: ProjectWorker.array(),
  now: "string > 0",
  "waiting?": ProjectWaiting,
  app: ProjectAppStatus,
  next: { "+": "reject", text: "string > 0", "action?": ProjectNextAction },
});
export type ProjectStatus = typeof ProjectStatus.infer;
