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
 * The hub keeps no numbered stages, so waits carry `stage: null`. A project
 * is its own child tenant, so every pending approval in that tenant is the
 * project's: the coordinator's deploys and the coder's package requests.
 */
import type { ApprovalScope, NativeApproval } from "@corbits-builder/client";
import { wording } from "../config.ts";
import { productClient } from "./transport.ts";
import type { Wait } from "./types.ts";
import { askOf } from "./ask.ts";
import { isInputPark, readConversationEvents } from "./conversation.ts";
import { workspaceTenantId } from "./auth.ts";

function approvalWait(
  approval: NativeApproval,
  projectId: string,
  tenantId: string,
): Omit<Wait, "projectTitle"> {
  const toolName =
    typeof approval.toolDefinition["name"] === "string"
      ? approval.toolDefinition["name"]
      : undefined;
  const ask = askOf(toolName, approval.toolArguments);
  const installs = ask.packages;
  return {
    id: `${approval.id}:approval`,
    projectId,
    tenantId,
    runId: approval.anchorRunId,
    stage: null,
    title:
      installs === undefined ? wording.wait.permission : wording.wait.install,
    consequence:
      installs === undefined
        ? wording.wait.wantsToRun(toolName)
        : wording.wait.wantsToInstall(installs),
    approvalId: approval.id,
    createdAt: approval.createdAt,
    ...ask,
  };
}

function parkWait(
  park: { seq: number; body: Record<string, unknown> },
  projectId: string,
  runId: string,
): Omit<Wait, "projectTitle"> {
  const question = park.body["question"];
  const prose =
    typeof question === "object" &&
    question !== null &&
    typeof (question as { prose?: unknown }).prose === "string"
      ? (question as { prose: string }).prose
      : undefined;
  return {
    id: `${projectId}:${String(park.seq)}:input-park`,
    projectId,
    runId,
    stage: null,
    title: wording.wait.question,
    consequence: prose ?? wording.wait.askedInConversation,
    park: {
      seq: park.seq,
      ...(prose === undefined ? {} : { question: prose }),
    },
  };
}

export async function openDecisions(): Promise<Wait[]> {
  const client = productClient();
  const tenantId = await workspaceTenantId();
  const { projects } = await client.projects(tenantId, { status: "active" });

  const waits: Wait[] = [];
  for (const record of projects) {
    const [conversation, { data: approvals }] = await Promise.all([
      readConversationEvents(record.projectId),
      client.nativeApprovals(record.tenantId),
    ]);
    if (conversation === null) continue;
    const pending = approvals.filter(
      (approval) => approval.status === "pending",
    );
    const projectWaits: Omit<Wait, "projectTitle">[] = pending.map((approval) =>
      approvalWait(approval, record.projectId, record.tenantId),
    );
    // Only the latest input park is the person's move; earlier parks that a
    // later SignalReceived released are not waiting on anything.
    const park = [...conversation.events].reverse().find(isInputPark);
    const released =
      park !== undefined &&
      conversation.events.some(
        (event) => event.seq > park.seq && event.type === "SignalReceived",
      );
    if (park !== undefined && !released)
      projectWaits.push(parkWait(park, record.projectId, conversation.runId));
    for (const wait of projectWaits)
      waits.push({ ...wait, projectTitle: record.title });
  }
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
