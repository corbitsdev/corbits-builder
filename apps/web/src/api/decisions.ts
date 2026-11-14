/**
 * The decision queue: `Wait`s fed from the two things a person's move can
 * wait on:
 *
 *  1. a pending native approval (the coordinator's own tool call, read off
 *     `GET /api/tenants/:t/approvals`), and
 *  2. the coordinator's open input park (`SignalAwaited` with
 *     `parkKind: "input"` in the project's committed conversation events),
 *     which is the person's move in the conversation.
 *
 * A project is its own child tenant, so every pending approval in that tenant
 * is the project's: the coordinator's deploys and the coder's package requests.
 */
import type { ApprovalScope, NativeApproval } from "@corbits-builder/client";
import { productClient } from "./transport.ts";
import type { Wait } from "./types.ts";
import { askOf } from "./ask.ts";
import { isInputPark, readConversationEvents } from "./conversation.ts";
import { workspaceTenantId } from "./auth.ts";

function approvalWait(approval: NativeApproval, tenantId: string): Wait {
  const toolName =
    typeof approval.toolDefinition["name"] === "string"
      ? approval.toolDefinition["name"]
      : undefined;
  return {
    tenantId,
    runId: approval.anchorRunId,
    approvalId: approval.id,
    createdAt: approval.createdAt,
    ...askOf(toolName, approval.toolArguments),
  };
}

function parkWait(park: { seq: number }, runId: string): Wait {
  return { runId, park: { seq: park.seq } };
}

export async function openDecisions(projectId: string): Promise<Wait[]> {
  const client = productClient();
  const tenantId = await workspaceTenantId();
  const { projects } = await client.projects(tenantId, { status: "active" });
  const record = projects.find((project) => project.projectId === projectId);
  if (record === undefined) return [];

  const [conversation, { data: approvals }] = await Promise.all([
    readConversationEvents(projectId),
    client.nativeApprovals(record.tenantId),
  ]);
  if (conversation.runId === null) return [];
  const waits = approvals
    .filter((approval) => approval.status === "pending")
    .map((approval) => approvalWait(approval, record.tenantId));
  // Only the latest input park is the person's move; earlier parks that a
  // later SignalReceived released are not waiting on anything.
  const park = [...conversation.events].reverse().find(isInputPark);
  const released =
    park !== undefined &&
    conversation.events.some(
      (event) => event.seq > park.seq && event.type === "SignalReceived",
    );
  if (park !== undefined && !released)
    waits.push(parkWait(park, conversation.runId));
  return waits;
}

export type DecisionChoice = "approve" | "reject";

/** Resolves one native approval; the hub binds nothing the person did not see in the park. */
export async function decideApproval(input: {
  tenantId: string;
  approvalId: string;
  decision: DecisionChoice;
  scope?: ApprovalScope;
  message?: string;
}): Promise<void> {
  await productClient().decideNativeApproval(
    input.tenantId,
    input.approvalId,
    input.decision,
    input.scope,
    input.decision === "reject" ? input.message : undefined,
  );
}
