import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { DB } from "@intx/db";
import { reconstructDurableConversation } from "@intx/workflow-host";
import { deriveWorkflowRunRepoId } from "@intx/workflow-deploy";
import { extractAddrSpec } from "@intx/mime";
import { isRunAddress } from "@intx/types/agent-address";
import {
  maxConversationTurns,
  type ConversationTextTurn,
  type ConversationThread,
} from "@corbits-builder/schemas/conversation";

import { withoutResumeContext } from "../config/resume.ts";
import { personTurnText } from "../config/specialist-ended.ts";
import {
  maxTurnText,
  readCoordinatorMailThreads,
} from "./conversation-threads.ts";
import { withCommittedAgentState } from "./committed-agent-state.ts";
import type { CoordinatorRepoDirSource } from "./coordinator-question.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "conversation-turns"]);

// The mirror stores every inbound message under the inference role `user`,
// whether a person or a workflow run sent it; the envelope's sender tells them apart.
const mirrorRole = (role: unknown): "inbound" | "assistant" | undefined => {
  if (role === "user" || role === "person") return "inbound";
  if (role === "assistant") return "assistant";
  return undefined;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textFromContent = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined;
  let text = "";
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string")
      text += block["text"];
  }
  return text.trim() === "" ? undefined : text;
};

const clipTurn = (text: string) =>
  text.length > maxTurnText ? text.slice(0, maxTurnText) : text;

// The durable copy of a person's mail keeps the routing line the runtime
// wrapped around their words. That line is not part of what they wrote.
const inboundEnvelope =
  /^\[From: ([^\]\r\n]+)\](?:\r?\n\[Subject: [^\]\r\n]*\])?(?:\r?\n){2}/;

// A workflow run's mail is read from the retained mail store with its real
// thread headers; the mirror's routing line names only its sender.
const runSent = (from: string): boolean => isRunAddress(extractAddrSpec(from));

// A missing or corrupt turn list is empty; it does not throw.
function mapMirrorConversationTurns(turns: unknown): ConversationTextTurn[] {
  if (!Array.isArray(turns)) return [];
  const mapped: ConversationTextTurn[] = [];
  for (const turn of turns) {
    if (!isRecord(turn)) continue;
    const role = mirrorRole(turn["role"]);
    const at = turn["timestamp"];
    if (role === undefined || typeof at !== "number" || !Number.isFinite(at))
      continue;
    const raw = textFromContent(turn["content"]);
    if (raw === undefined) continue;
    if (role === "assistant") {
      mapped.push({ role, text: clipTurn(raw), at });
      continue;
    }
    const from = inboundEnvelope.exec(raw)?.[1];
    if (from !== undefined && runSent(from)) continue;
    const text = withoutResumeContext(raw.replace(inboundEnvelope, ""));
    if (text === undefined || text.trim() === "") continue;
    mapped.push({ role: "person", text: clipTurn(personTurnText(text)), at });
  }
  mapped.sort((left, right) => left.at - right.at);
  return mapped.length > maxConversationTurns
    ? mapped.slice(-maxConversationTurns)
    : mapped;
}

/**
 * Person and assistant text from every agent-state directory in the run repo.
 * A missing or corrupt mirror is an empty list so the events read can still
 * return the committed native projection.
 */
export async function readDurableConversationTurns(input: {
  repoStore: CoordinatorRepoDirSource;
  address: string;
}): Promise<ConversationTextTurn[]> {
  try {
    const repoDir = input.repoStore.getRepoDir({
      kind: "workflow-run",
      id: deriveWorkflowRunRepoId(input.address),
    });
    const turns = await withCommittedAgentState(
      repoDir,
      async (agentStateRoot) => {
        const entries = await readdir(agentStateRoot, { withFileTypes: true });
        const keys = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
        const collected: unknown[] = [];
        for (const agentKey of keys) {
          try {
            const snapshot = await reconstructDurableConversation(
              join(agentStateRoot, agentKey),
              agentKey,
            );
            if (snapshot === null) continue;
            for (const turn of snapshot.turns) collected.push(turn);
          } catch (error) {
            // One damaged agent mirror must not drop the other agents' turns.
            log.error(
              "Agent conversation mirror unreadable",
              requestErrorMetadata(error),
            );
          }
        }
        return collected;
      },
    );
    return mapMirrorConversationTurns(turns ?? []);
  } catch {
    return [];
  }
}

/**
 * One coordinator run's share of the person's thread: its durable mirror
 * turns plus, with a retained mail store, participant mail on person threads.
 * Threads are undefined without a mail store.
 */
export async function projectRunTurns(input: {
  db: DB["db"];
  tenantId: string;
  repoStore: CoordinatorRepoDirSource;
  mailDirectory: string | undefined;
  runId: string;
  address: string;
}): Promise<{ turns: ConversationTextTurn[]; threads?: ConversationThread[] }> {
  const turns = await readDurableConversationTurns(input);
  if (input.mailDirectory === undefined) return { turns };
  const mail = await readCoordinatorMailThreads({
    ...input,
    directory: input.mailDirectory,
  });
  return { turns: [...turns, ...mail.participantTurns], threads: mail.threads };
}
