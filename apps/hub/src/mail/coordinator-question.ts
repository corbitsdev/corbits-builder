import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@intx/log";
import { reconstructDurableConversation } from "@intx/workflow-host";
import { deriveWorkflowRunRepoId } from "@intx/workflow-deploy";

import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { withCommittedAgentState } from "./committed-agent-state.ts";

const log = getLogger(["corbits-builder", "hub", "coordinator-question"]);

// The input park (`SignalAwaited` with `parkKind: "input"`) carries no wording:
// the coordinator's turn reply is what reaches the person as mail, and its
// durable copy is the warm agent's conversation mirror under
// `agent-state/<agentKey>/` in the same workflow-run repo the event log lives
// in (checkpoint.json + WAL, written by the sidecar's boundary mirror).

export type CoordinatorRepoDirSource = {
  getRepoDir(repoId: { kind: "workflow-run"; id: string }): string;
};

type CoordinatorQuestionProse = Readonly<{
  prose: string;
  source: Readonly<{ kind: "coordinator-turn"; agentKey: string }>;
}>;

export function createCoordinatorQuestionProseReader(options: {
  repoStore: CoordinatorRepoDirSource;
}) {
  return async function readQuestionProse(input: {
    address: string;
    park: Record<string, unknown>;
  }): Promise<CoordinatorQuestionProse | undefined> {
    const repoDir = options.repoStore.getRepoDir({
      kind: "workflow-run",
      id: deriveWorkflowRunRepoId(input.address),
    });
    // The asking turn completed before the runtime committed the re-arm park,
    // so the park's own commit time bounds which turns may have asked it.
    const parkedAt = input.park["at"];
    const deadline =
      typeof parkedAt === "string" && Number.isFinite(Date.parse(parkedAt))
        ? Date.parse(parkedAt)
        : undefined;
    let best:
      | { prose: string; agentKey: string; timestamp: number }
      | undefined;
    try {
      best = await withCommittedAgentState(repoDir, async (agentStateRoot) => {
        const entries = await readdir(agentStateRoot, { withFileTypes: true });
        const keys = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
        let found:
          | { prose: string; agentKey: string; timestamp: number }
          | undefined;
        for (const agentKey of keys) {
          let turns: unknown[];
          try {
            const snapshot = await reconstructDurableConversation(
              join(agentStateRoot, agentKey),
              agentKey,
            );
            if (snapshot === null) continue;
            turns = snapshot.turns;
          } catch (error) {
            // A corrupt mirror leaves the rest of the conversation projection
            // intact; the card falls back to the verbatim park rather than
            // guessing at wording. The reader still throws on the restore path,
            // where a lost conversation is a correctness failure.
            log.warn("Agent conversation mirror unreadable", {
              agentKey,
              ...errorCode(error),
              ...requestErrorMetadata(error),
            });
            continue;
          }
          for (const turn of turns) {
            const candidate = assistantText(turn);
            if (candidate === undefined) continue;
            if (deadline !== undefined && candidate.timestamp > deadline)
              continue;
            if (found === undefined || candidate.timestamp >= found.timestamp)
              found = {
                prose: candidate.text,
                agentKey,
                timestamp: candidate.timestamp,
              };
          }
        }
        return found;
      });
    } catch (error) {
      log.warn("Coordinator question prose unreadable", {
        ...errorCode(error),
        ...requestErrorMetadata(error),
      });
      return undefined;
    }
    if (best === undefined || best.prose.trim() === "") return undefined;
    return {
      prose: best.prose,
      source: { kind: "coordinator-turn", agentKey: best.agentKey },
    };
  };
}

function assistantText(
  turn: unknown,
): { text: string; timestamp: number } | undefined {
  if (typeof turn !== "object" || turn === null) return undefined;
  const record = turn as {
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
  };
  if (record.role !== "assistant" || !Array.isArray(record.content))
    return undefined;
  if (typeof record.timestamp !== "number") return undefined;
  const text = record.content
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      const part = block as { type?: unknown; text?: unknown };
      return part.type === "text" && typeof part.text === "string"
        ? part.text
        : "";
    })
    .join("");
  if (text.trim() === "") return undefined;
  return { text, timestamp: record.timestamp };
}
