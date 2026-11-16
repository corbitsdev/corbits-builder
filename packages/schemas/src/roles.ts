import { type } from "arktype";

export const WorkflowRole = type("string > 0");
export type WorkflowRole = typeof WorkflowRole.infer;
