import { type } from "arktype";

// The name of the role a run plays. Which names there are is the plugins' to declare, so the hub
// checks a name against its catalog where it reads one, and the wire carries the name alone.
export const WorkflowRole = type("string > 0");
export type WorkflowRole = typeof WorkflowRole.infer;
