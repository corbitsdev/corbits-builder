import { WorkflowHttpError } from "@corbits-builder/tools-hub";
import { TraversalError } from "arktype";

export class Refusal extends Error {}

export const notApproved = (kind: string, version: number) =>
  new Refusal(
    kind +
      "_not_approved: a person has not approved " +
      kind +
      " version " +
      String(version) +
      (kind === "design"
        ? "; they approve a design by confirming a design option in the conversation"
        : "; ask them with request_approval"),
  );

// A turn's tool calls run concurrently (INFERENCE.md "Parallel execution"), so two starts of one
// unbounded role in the same turn would both find it missing from inFlight.
const starting = new Set<string>();
export async function startOnce<T>(
  key: string,
  role: string,
  start: () => Promise<T>,
): Promise<T> {
  if (starting.has(key))
    throw new Refusal(
      role + "_starting: a " + role + " is already starting for this project",
    );
  starting.add(key);
  try {
    return await start();
  } finally {
    starting.delete(key);
  }
}

export function validArguments<T>(
  schema: { assert: (value: unknown) => T },
  value: unknown,
): T {
  try {
    return schema.assert(value);
  } catch (error) {
    if (error instanceof TraversalError)
      throw new Refusal("invalid_arguments: " + error.message);
    throw error;
  }
}

// Authorization refusals stay a bare code; any other hub refusal carries the
// code with its field issues so the model can correct the call.
function hubRefusal(error: WorkflowHttpError): string {
  const code = error.refusalCode ?? error.message;
  if (error.status === 401 || error.status === 403 || !error.issues?.length)
    return code;
  return (
    code +
    ": " +
    error.issues.map((issue) => issue.path + " " + issue.message).join("; ")
  );
}

export const refusalText = (error: unknown) =>
  error instanceof Refusal
    ? error.message
    : error instanceof WorkflowHttpError
      ? hubRefusal(error)
      : error instanceof Error
        ? error.name + ": " + error.message
        : String(error);
