import type { DB } from "@intx/db";
import {
  createCommittedStepStateReader,
  reconstructStepState,
  WORKFLOW_RUN_REF,
  WORKFLOW_RUN_RUNS_PREFIX,
  workflowRunStepStatePrefix,
  type ReconstructedStepState,
  type RepoStore,
} from "@intx/hub-sessions";
import { deriveWorkflowRunRepoId } from "@intx/workflow-deploy";
import { extractAddrSpec } from "@intx/mime";
import { isRunAddress } from "@intx/types/agent-address";
import { isMail } from "@intx/types/runtime";
import { ApprovalDecision } from "@intx/types/signals";
import { type } from "arktype";
import {
  clippedTurnText,
  deliveredText,
  maxConversationTurns,
  type ConversationTextTurn,
  type ConversationThread,
} from "@corbits-builder/schemas/conversation";

import {
  approvalDecisionLine,
  withoutResumeContext,
} from "../config/resume.ts";
import { personTurnText } from "../config/specialist-ended.ts";
import { declinedWords } from "../config/decline.ts";
import { readCoordinatorMailThreads } from "./conversation-threads.ts";
import { getLogger } from "@intx/log";
import { errorCode, requestErrorMetadata } from "../request-error.ts";
import { parseJson } from "../lib/json.ts";

const log = getLogger(["corbits-builder", "hub", "conversation-turns"]);

export type ConversationRepoStore = Pick<RepoStore, "openCommittedReads">;

/**
 * Every agent step's committed state in a run's workflow-run repo, at
 * `runs/<runId>/steps/<stepId>/state/`. Each step is read on its own so one
 * damaged step leaves the others readable.
 */
export async function committedStepStates(
  repoStore: ConversationRepoStore,
  address: string,
): Promise<
  { stepId: string; read: () => Promise<ReconstructedStepState | null> }[]
> {
  const reads = await repoStore.openCommittedReads(
    { kind: "hub" },
    { kind: "workflow-run", id: deriveWorkflowRunRepoId(address) },
    WORKFLOW_RUN_REF,
  );
  if (reads === null) return [];
  const steps = [];
  for (const run of await reads.listDir(WORKFLOW_RUN_RUNS_PREFIX)) {
    if (run.type !== "tree") continue;
    // Interchange exports the layout's state prefix but not its steps folder.
    const stepsDir = `${WORKFLOW_RUN_RUNS_PREFIX}/${run.name}/steps`;
    for (const step of await reads.listDir(stepsDir)) {
      if (step.type !== "tree") continue;
      const stepId = decodeURIComponent(step.name);
      steps.push({
        stepId,
        read: () =>
          reconstructStepState(
            createCommittedStepStateReader(
              reads,
              workflowRunStepStatePrefix(run.name, stepId),
            ),
            `${address} run ${run.name} step ${stepId}`,
          ),
      });
    }
  }
  return steps;
}

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

// The durable copy of a person's mail keeps the routing line the runtime
// wrapped around their words. That line is not part of what they wrote.
const inboundEnvelope =
  /^\[From: ([^\]\r\n]+)\](?:\r?\n\[Subject: [^\]\r\n]*\])?(?:\r?\n){2}/;

// A workflow run's mail is read from the retained mail store with its real
// thread headers; the mirror's routing line names only its sender.
const runSent = (from: string): boolean => isRunAddress(extractAddrSpec(from));

// Interchange delivers the person's approval decision to the waiting tool from this address, as
// JSON. The page already shows the decision on its approval card; a resumed coordinator has no card.
const APPROVAL_SIGNAL_SENDER = "signal@local";

/**
 * How the person's approval decisions read: "note" keeps only the note they sent with a
 * decision, for the page; "decision" reads each decision as a plain line, for a resumed
 * coordinator.
 */
export type ApprovalDecisionTurns = "note" | "decision";

function approvalText(
  body: string,
  decisions: ApprovalDecisionTurns,
): string | undefined {
  const decision = ApprovalDecision(parseJson(body));
  if (decision instanceof type.errors) return undefined;
  const words = declinedWords(decision.message);
  return decisions === "note"
    ? words
    : approvalDecisionLine({
        outcome: decision.outcome,
        ...(words === undefined ? {} : { message: words }),
      });
}

function personText(body: string): string | undefined {
  const text = withoutResumeContext(deliveredText(body));
  if (text === undefined || text.trim() === "") return undefined;
  return clippedTurnText(personTurnText(text));
}

// A missing or corrupt turn list is empty; it does not throw.
function mapMirrorConversationTurns(
  turns: unknown,
  decisions: ApprovalDecisionTurns,
): ConversationTextTurn[] {
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
      mapped.push({ role, text: clippedTurnText(raw), at });
      continue;
    }
    const from = inboundEnvelope.exec(raw)?.[1];
    if (from !== undefined && runSent(from)) continue;
    if (
      from !== undefined &&
      extractAddrSpec(from) === APPROVAL_SIGNAL_SENDER
    ) {
      const text = approvalText(raw.replace(inboundEnvelope, ""), decisions);
      if (text !== undefined && text.trim() !== "")
        mapped.push({ role: "person", text: clippedTurnText(text), at });
      continue;
    }
    const text = personText(raw.replace(inboundEnvelope, ""));
    if (text !== undefined) mapped.push({ role: "person", text, at });
  }
  mapped.sort((left, right) => left.at - right.at);
  return mapped.length > maxConversationTurns
    ? mapped.slice(-maxConversationTurns)
    : mapped;
}

/**
 * The person's mail the run has received but its coordinator has not saved yet. The coordinator
 * saves a message only with its reply, and takes a message in after the run commits its receipt,
 * so a received message is unsaved while no saved person turn is as late as the receipt.
 */
export function unsavedPersonTurns(
  events: unknown,
  saved: readonly ConversationTextTurn[],
): ConversationTextTurn[] {
  if (!Array.isArray(events)) return [];
  const latestSaved = Math.max(
    -Infinity,
    ...saved.flatMap((turn) => (turn.role === "person" ? [turn.at] : [])),
  );
  const unsaved: ConversationTextTurn[] = [];
  for (const event of events) {
    if (!isRecord(event) || event["type"] !== "SignalReceived") continue;
    const body = event["body"];
    if (!isRecord(body) || typeof body["at"] !== "string") continue;
    const at = Date.parse(body["at"]);
    const mail = body["payload"];
    if (!(at > latestSaved) || !isMail(mail)) continue;
    if (mail.headers.from !== undefined && runSent(mail.headers.from)) continue;
    const text = personText(
      mail.parts
        .flatMap((part) =>
          part.disposition !== "attachment" &&
          part.contentType.startsWith("text/plain") &&
          part.text !== undefined
            ? [part.text]
            : [],
        )
        .join(""),
    );
    if (text !== undefined) unsaved.push({ role: "person", text, at });
  }
  return unsaved;
}

/**
 * Person and assistant text from every agent step's state in the run repo.
 * A missing or corrupt mirror is an empty list so the events read can still
 * return the committed native projection.
 */
export async function readDurableConversationTurns(input: {
  repoStore: ConversationRepoStore;
  address: string;
  approvalDecisions: ApprovalDecisionTurns;
}): Promise<ConversationTextTurn[]> {
  try {
    const turns: unknown[] = [];
    for (const step of await committedStepStates(
      input.repoStore,
      input.address,
    )) {
      try {
        const state = await step.read();
        if (state === null) continue;
        for (const turn of state.turns) turns.push(turn);
      } catch (error) {
        // One damaged agent mirror must not drop the other agents' turns.
        log.error("Agent conversation mirror unreadable", {
          ...errorCode(error),
          ...requestErrorMetadata(error),
        });
      }
    }
    return mapMirrorConversationTurns(turns, input.approvalDecisions);
  } catch (error) {
    log.warn("Durable conversation unreadable", {
      ...errorCode(error),
      ...requestErrorMetadata(error),
    });
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
  repoStore: ConversationRepoStore;
  mailDirectory: string | undefined;
  runId: string;
  address: string;
}): Promise<{ turns: ConversationTextTurn[]; threads?: ConversationThread[] }> {
  const turns = await readDurableConversationTurns({
    ...input,
    approvalDecisions: "note",
  });
  if (input.mailDirectory === undefined) return { turns };
  const mail = await readCoordinatorMailThreads({
    ...input,
    directory: input.mailDirectory,
  });
  return { turns: [...turns, ...mail.participantTurns], threads: mail.threads };
}
