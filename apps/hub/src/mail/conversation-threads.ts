import { join } from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@intx/db";
import { workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import { decodeMail, extractAddrSpec } from "@intx/mime";
import { listMail } from "@intx/storage-isogit/node";
import { isRunAddress, parseRunAddress } from "@intx/types/agent-address";
import { SPECIALIST_RESULT_TYPE } from "@corbits-builder/schemas/native-specialist";
import {
  maxConversationTurns,
  type ConversationTextTurn,
  type ConversationThread,
} from "@corbits-builder/schemas/conversation";

import { personTurnText } from "../config/specialist-ended.ts";
import { spawnedWorkflowRole } from "../workflows/spawn-role.ts";
import { getLogger } from "@intx/log";
import { requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "conversation-threads"]);

// ConversationEvents rejects a longer turn than this.
export const maxTurnText = 20000;

type ThreadMail = {
  ordinal: number;
  messageId: string;
  from: string;
  text: string;
  at: number;
};

// A writer's plain reply after its structured result only restates it.
const withoutResultEchoes = (messages: ThreadMail[]): ThreadMail[] => {
  const reported = new Set<string>();
  return messages.filter((message) => {
    if (message.text.includes(SPECIALIST_RESULT_TYPE)) {
      reported.add(message.from);
      return true;
    }
    return !reported.has(message.from);
  });
};

const addrSpec = (line: string | undefined): string | undefined => {
  if (line === undefined || line.trim() === "") return undefined;
  try {
    return extractAddrSpec(line).toLowerCase();
  } catch {
    return undefined;
  }
};

/**
 * The coordinator's retained native mail, grouped by the mail store's own
 * References thread and read from its real From/To/Cc headers. A thread with
 * a person among its participants continues the person's conversation: its
 * mail from other runs is returned as participant turns, while the
 * coordinator's own replies already reach `turns` from the durable mirror.
 * A thread among runs only is a specialist thread.
 */
export async function readCoordinatorMailThreads(input: {
  db: DB["db"];
  tenantId: string;
  directory: string;
  runId: string;
  address: string;
}): Promise<{
  participantTurns: ConversationTextTurn[];
  threads: ConversationThread[];
}> {
  const coordinator = input.address.toLowerCase();
  const mail = new Map<
    string,
    { participants: Set<string>; messages: ThreadMail[] }
  >();
  let entries: Awaited<ReturnType<typeof listMail>>;
  try {
    entries = await listMail(join(input.directory, input.runId));
  } catch (error) {
    log.error(
      "Coordinator mail journal unreadable",
      requestErrorMetadata(error),
    );
    return { participantTurns: [], threads: [] };
  }
  for (const entry of entries) {
    let decoded: ReturnType<typeof decodeMail>;
    try {
      decoded = decodeMail(entry.raw);
    } catch (error) {
      log.error("Journaled mail is undecodable", requestErrorMetadata(error));
      continue;
    }
    const { headers } = decoded;
    const from = addrSpec(headers.from);
    const at = Date.parse(headers.date ?? "");
    const part = decoded.parts.find(
      (item) => item.contentType === "text/plain",
    );
    if (from === undefined || part === undefined || !Number.isFinite(at))
      continue;
    const text = new TextDecoder()
      .decode(part.content)
      .trim()
      .slice(0, maxTurnText);
    const thread = mail.get(entry.threadId) ?? {
      participants: new Set(),
      messages: [],
    };
    mail.set(entry.threadId, thread);
    for (const line of [headers.from, ...headers.to, ...(headers.cc ?? [])]) {
      const participant = addrSpec(line);
      if (participant !== undefined) thread.participants.add(participant);
    }
    if (text !== "")
      thread.messages.push({
        ordinal: entry.ordinal,
        messageId: entry.messageId,
        from,
        text,
        at,
      });
  }

  const runs = [
    ...new Set(
      [...mail.values()].flatMap((thread) => [...thread.participants]),
    ),
  ].filter(
    (participant) => participant !== coordinator && isRunAddress(participant),
  );
  const roles = new Map<string, string>();
  if (runs.length > 0) {
    const rows = await input.db
      .select({
        address: workflowRun.address,
        bundle: workflowRunLaunchSpec.frozenApprovalBundle,
      })
      .from(workflowRun)
      .innerJoin(
        workflowRunLaunchSpec,
        eq(workflowRunLaunchSpec.anchorRunId, workflowRun.id),
      )
      .where(
        and(
          eq(workflowRun.tenantId, input.tenantId),
          inArray(workflowRun.address, runs),
        ),
      );
    for (const row of rows) {
      const role = spawnedWorkflowRole(row.bundle);
      if (row.address && role) roles.set(row.address.toLowerCase(), role);
    }
  }
  const label = (participant: string) =>
    roles.get(participant) ??
    parseRunAddress(participant)?.runId ??
    participant;
  const turn = (message: ThreadMail): ConversationTextTurn => {
    if (message.from === coordinator)
      return { role: "assistant", text: message.text, at: message.at };
    if (!isRunAddress(message.from))
      return {
        role: "person",
        text: personTurnText(message.text),
        at: message.at,
      };
    return {
      role: "participant",
      sender: label(message.from),
      text: message.text,
      at: message.at,
    };
  };

  const participantTurns: ConversationTextTurn[] = [];
  const threads: ConversationThread[] = [];
  for (const [threadId, thread] of mail) {
    const messages = withoutResultEchoes(
      thread.messages.sort((left, right) => left.ordinal - right.ordinal),
    );
    if (
      [...thread.participants].some((participant) => !isRunAddress(participant))
    ) {
      for (const message of messages)
        if (message.from !== coordinator && isRunAddress(message.from))
          participantTurns.push(turn(message));
      continue;
    }
    if (messages.length === 0) continue;
    threads.push({
      id: messages[0]?.messageId ?? threadId,
      participants: [...thread.participants]
        .filter((participant) => participant !== coordinator)
        .map(label),
      turns: messages.slice(-maxConversationTurns).map(turn),
    });
  }
  threads.sort(
    (left, right) => (left.turns[0]?.at ?? 0) - (right.turns[0]?.at ?? 0),
  );
  return { participantTurns, threads };
}
