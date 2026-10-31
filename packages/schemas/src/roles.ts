import { type } from "arktype";

export const SpawnedRole = type("'writer' | 'reviewer' | 'coder' | 'designer'");
export type SpawnedRole = typeof SpawnedRole.infer;
export const WorkflowRole = SpawnedRole.or("'coordinator'");
export type WorkflowRole = typeof WorkflowRole.infer;
