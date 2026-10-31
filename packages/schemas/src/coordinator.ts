import { type } from "arktype";
import { ProjectId } from "./project.ts";

export const BindCoordinator = type({
  "+": "reject",
  runId: "0 < string <= 256",
  idempotencyKey: "0 < string <= 256",
});
export const CoordinatorBindingReceipt = type({
  projectId: ProjectId,
  runId: "string",
});
