/**
 * Map the project conversation onto the vendored part model.
 *
 * Durable turns from the hub are person and assistant text only. A live
 * inference frame can also carry thinking text and tool calls, which become
 * reasoning and tool parts for MessageParts. A pending native approval is a
 * tool part with its approval record; the decision itself stays on the
 * existing decide path.
 */
import type {
  ConversationPart,
  PartTool,
  ToolApprovalStatus,
} from "@corbits/react-ui";
import {
  applyRunStreamEvent,
  type RunStreamEvent,
} from "../../api/run-stream.ts";

export type LiveTurnState = {
  readonly text: string;
  readonly parts: readonly ConversationPart[];
};

export const emptyLiveTurn: LiveTurnState = { text: "", parts: [] };

type ToolCallSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly partialArguments: string;
};

type FinishedCall = {
  readonly callId: string;
  readonly name: string;
  readonly arguments: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCallsOf(value: unknown): readonly ToolCallSnapshot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const calls: ToolCallSnapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    const name = entry["name"];
    const partialArguments = entry["partialArguments"];
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof name !== "string" || name.length === 0) continue;
    calls.push({
      id,
      name,
      partialArguments:
        typeof partialArguments === "string" ? partialArguments : "",
    });
  }
  return calls;
}

function finishedCallOf(
  data: RunStreamEvent["data"],
): FinishedCall | undefined {
  const callId = data?.callId;
  const name = data?.name;
  if (typeof callId !== "string" || callId.length === 0) return undefined;
  if (typeof name !== "string" || name.length === 0) return undefined;
  return { callId, name, arguments: data?.arguments };
}

function reasoningText(parts: readonly ConversationPart[]): string | undefined {
  const found = parts.find((part) => part.kind === "reasoning");
  return found?.kind === "reasoning" ? found.text : undefined;
}

function toolCalls(parts: readonly ConversationPart[]): readonly PartTool[] {
  return parts.flatMap((part) =>
    part.kind === "tool-trace"
      ? [part]
      : part.kind === "tool-batch"
        ? part.tools
        : [],
  );
}

function runningTools(
  parts: readonly ConversationPart[],
): readonly ToolCallSnapshot[] {
  return toolCalls(parts).flatMap((part) => {
    if (part.status === "output-available") return [];
    return [
      {
        id: part.toolCallId,
        name: part.name,
        partialArguments: typeof part.input === "string" ? part.input : "",
      },
    ];
  });
}

function finishedTools(
  parts: readonly ConversationPart[],
): Map<string, PartTool> {
  const finished = new Map<string, PartTool>();
  for (const part of toolCalls(parts)) {
    if (part.status === "output-available") finished.set(part.toolCallId, part);
  }
  return finished;
}

/**
 * Fold one native frame onto the live assistant turn. Text follows the same
 * rules as `applyRunStreamEvent`. Thinking and tool calls come from the
 * frame's partial snapshot when it carries them, and a finished tool call
 * keeps its arguments.
 */
export function foldLiveTurn(
  current: LiveTurnState,
  event: RunStreamEvent,
): { turn: LiveTurnState; refresh: boolean } {
  const folded = applyRunStreamEvent(current.text, event);
  if (event.type === "inference.start" || event.type === "inference.error") {
    return { turn: { text: folded.live, parts: [] }, refresh: folded.refresh };
  }
  const partial = event.data?.partial;
  const thinking =
    typeof partial?.thinking === "string"
      ? partial.thinking
      : reasoningText(current.parts);
  const calls = toolCallsOf(partial?.toolCalls) ?? runningTools(current.parts);
  const finished = finishedTools(current.parts);
  if (event.type === "inference.tool_call.end") {
    const end = finishedCallOf(event.data);
    if (end !== undefined) {
      finished.set(end.callId, {
        kind: "tool-trace",
        toolCallId: end.callId,
        name: end.name,
        status: "output-available",
        input: end.arguments,
      });
    }
  }
  const parts: ConversationPart[] = [];
  if (thinking !== undefined && thinking.length > 0) {
    parts.push({ kind: "reasoning", text: thinking });
  }
  const seen = new Set<string>();
  const tools: PartTool[] = [];
  for (const call of calls) {
    seen.add(call.id);
    const done = finished.get(call.id);
    tools.push(
      done ?? {
        kind: "tool-trace",
        toolCallId: call.id,
        name: call.name,
        status: "running",
        input: call.partialArguments,
      },
    );
  }
  for (const [id, part] of finished) {
    if (!seen.has(id)) tools.push(part);
  }
  // One response's calls run together (INFERENCE.md, parallel execution), so several are one batch.
  const [first] = tools;
  if (tools.length > 1 && first !== undefined)
    parts.push({ kind: "tool-batch", id: `batch:${first.toolCallId}`, tools });
  else parts.push(...tools);
  if (folded.live.length > 0) parts.push({ kind: "text", text: folded.live });
  return { turn: { text: folded.live, parts }, refresh: folded.refresh };
}

/**
 * A native approval as a tool part, pending or as its record settled it. Its
 * name stays empty: the card is titled by the document it approves, never by
 * the tool that asked.
 */
export function approvalToolPart(
  approvalId: string,
  outcome?: {
    readonly status: ToolApprovalStatus;
    readonly scope?: "once" | "always";
  },
): PartTool {
  const status = outcome?.status ?? "pending";
  const decided = status === "approved" || status === "rejected";
  return {
    kind: "tool-trace",
    toolCallId: approvalId,
    name: "",
    status:
      status === "pending"
        ? "approval-requested"
        : status === "approved"
          ? "output-available"
          : "output-denied",
    approval: {
      id: approvalId,
      status,
      scope: decided ? (outcome?.scope ?? "once") : null,
      timeoutAt: null,
    },
  };
}
