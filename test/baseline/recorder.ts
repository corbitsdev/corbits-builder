import { type } from "arktype";
import type { NativeApproval, ProductApiClient } from "@corbits-builder/client";
import type { ConversationEvents } from "@corbits-builder/schemas/conversation";
import {
  readRunConversation,
  type RunConversation,
} from "../e2e/support/extract.ts";
import type { TestHubHandle } from "../e2e/support/hub.ts";
import type { CoordinatorMode } from "@corbits-builder/hub/environment";
import { openQuestionPark } from "../e2e/support/pipeline-driver.ts";

export const Move = type(
  "'discover' | 'open:pick-fonts' | 'open:pick-colours' | 'ask' | 'read' | 'reply'",
).or(/^execute:[a-z][a-z0-9-]*$/);

const Remark = type({
  "+": "reject",
  text: "string > 0",
  // Each is a run of first moves; a run that begins the observed moves, with or without the reads
  // that lead them, is acceptable.
  acceptable: Move.array().atLeastLength(1).array(),
  unacceptable: { "+": "reject", anywhere: Move.array(), first: Move.array() },
});
export type Remark = typeof Remark.infer;

export const Cases = type({
  "+": "reject",
  models: type({
    "+": "reject",
    id: "string > 0",
    profile: "string > 0",
    // The hub's variable for the provider key a real model needs.
    "key?": "string > 0",
  }).array(),
  hints: type("'off' | 'triggers' | 'fields'").array(),
  repeats: "number.integer > 0",
  remarks: Remark.array(),
});
export type Cases = typeof Cases.infer;
export type CaseModel = Cases["models"][number];
export type HintSetting = Cases["hints"][number];

// The hub appends this note to the person's message (apps/hub/src/config/screen-plugins.ts).
const HINT_LEAD = "Builder's note, not written by the person:";
const PROJECT_READS = new Set(["read_artifact"]);

export type ObservedMove = Readonly<{
  move: string;
  tool: string;
  arguments: Record<string, unknown>;
  refused: boolean;
}>;

// Where the conversation stood once the import settled; the case's moves are what came after.
export type Baseline = Readonly<{
  toolCalls: number;
  personTexts: number;
  assistantTurns: number;
}>;

export type Observation = Readonly<{
  stored: RunConversation | undefined;
  storedError: string | undefined;
  moves: readonly ObservedMove[];
  parked: boolean;
  pendingApproval: boolean;
  textTurns: readonly string[];
}>;

// A workflow started is execute:<handle>; classic's instruct_coder is change-app's work by another name.
function moveOf(tool: string, args: Record<string, unknown>): string {
  if (tool === "discover") return tool;
  if (tool === "instruct_coder") return "execute:change-app";
  if (tool === "execute") return `execute:${String(args["plugin"])}`;
  if (tool === "question")
    return typeof args["plugin"] === "string"
      ? `open:${args["plugin"]}`
      : "ask";
  if (PROJECT_READS.has(tool)) return "read";
  return `tool:${tool}`;
}

function inFlight(tool: string, args: Record<string, unknown>): ObservedMove {
  return { move: moveOf(tool, args), tool, arguments: args, refused: false };
}

async function tryRead(
  hub: TestHubHandle,
  runId: string,
): Promise<RunConversation | Error> {
  try {
    return await readRunConversation(hub, runId, "coordinate");
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

/**
 * The stored coordinator conversation, retried briefly because a turn still in progress has not
 * been committed yet; the last failure when it still cannot be read.
 */
export async function readStored(
  hub: TestHubHandle,
  runId: string,
  attempts: number,
): Promise<RunConversation | Error> {
  let read = await tryRead(hub, runId);
  for (
    let attempt = 1;
    attempt < attempts && read instanceof Error;
    attempt++
  ) {
    await Bun.sleep(1_000);
    read = await tryRead(hub, runId);
  }
  return read;
}

export function baselineOf(
  stored: RunConversation,
  events: ConversationEvents,
): Baseline {
  return {
    toolCalls: stored.toolCalls.length,
    personTexts: stored.personTexts.length,
    assistantTurns: assistantTurns(events).length,
  };
}

function assistantTurns(events: ConversationEvents): string[] {
  return (events.turns ?? []).flatMap((turn) =>
    turn.role === "assistant" ? [turn.text] : [],
  );
}

/**
 * The coordinator's moves since the baseline, in order: its finished tool calls from the stored
 * conversation, then what it is waiting on (a parked question or a pending approval), then a closing
 * text turn the person saw, which is an ask when it holds a question mark and a reply otherwise.
 */
export async function observe(
  client: ProductApiClient,
  project: Readonly<{ tenantId: string; projectId: string }>,
  stored: RunConversation | Error,
  since: Baseline,
): Promise<Observation> {
  const [events, { data: approvals }] = await Promise.all([
    client.conversationEvents(project.tenantId, project.projectId),
    client.nativeApprovals(project.tenantId),
  ]);
  const calls =
    stored instanceof Error ? [] : stored.toolCalls.slice(since.toolCalls);
  const finished = calls.flatMap((call) =>
    call.result
      ? [
          {
            move: moveOf(call.name, call.arguments),
            tool: call.name,
            arguments: call.arguments,
            refused: call.result.isError,
          },
        ]
      : [],
  );
  const park = openQuestionPark(events.events);
  const pending = approvals.filter(
    (approval: NativeApproval) => approval.status === "pending",
  );
  const waiting = pending.map((approval) =>
    inFlight(String(approval.toolDefinition["name"]), approval.toolArguments),
  );
  const question = type({ "[string]": "unknown" })(park?.body["question"]);
  if (park && !(question instanceof type.errors))
    waiting.unshift(inFlight("question", question));
  // A call still running that neither parked nor waits on an approval.
  const unfinished = calls.flatMap((call) =>
    call.result ? [] : [inFlight(call.name, call.arguments)],
  );
  const textTurns = assistantTurns(events).slice(since.assistantTurns);
  const closing = textTurns.at(-1);
  const moves = [...finished, ...(waiting.length > 0 ? waiting : unfinished)];
  if (closing !== undefined && waiting.length === 0)
    moves.push({
      move: closing.includes("?") ? "ask" : "reply",
      tool: "text",
      arguments: { text: closing },
      refused: false,
    });
  return {
    stored: stored instanceof Error ? undefined : stored,
    storedError: stored instanceof Error ? stored.message : undefined,
    moves,
    parked: park !== undefined,
    pendingApproval: pending.length > 0,
    textTurns,
  };
}

/** The plugins the hub's note under the person's message named, or none when it added no note. */
export function hintNote(personText: string): {
  reached: boolean;
  plugins: string[];
} {
  const lines = personText.replace(/\r\n?/g, "\n").split("\n");
  const lead = lines.findIndex((line) => line.startsWith(HINT_LEAD));
  if (lead < 0) return { reached: false, plugins: [] };
  return {
    reached: true,
    plugins: lines
      .slice(lead + 1)
      .flatMap((line) => /^- ([a-z0-9-]+):/.exec(line)?.[1] ?? []),
  };
}

export function verdict(
  remark: Remark,
  moves: readonly string[],
): "acceptable" | "unacceptable" | "other" {
  // A refused screen call and the call that follows it are one attempt.
  const collapsed = moves.filter((move, index) => move !== moves[index - 1]);
  const first = collapsed[0];
  const anywhere: readonly string[] = remark.unacceptable.anywhere;
  const atFirst: readonly string[] = remark.unacceptable.first;
  if (
    collapsed.some((move) => anywhere.includes(move)) ||
    (first !== undefined && atFirst.includes(first))
  )
    return "unacceptable";
  const acting = collapsed.findIndex((move) => move !== "read");
  const afterReads = acting < 0 ? [] : collapsed.slice(acting);
  if (
    [collapsed, afterReads].some((observed) =>
      remark.acceptable.some((run) =>
        run.every((move, index) => observed[index] === move),
      ),
    )
  )
    return "acceptable";
  return "other";
}

export function recordCase(
  input: Readonly<{
    remark: Remark;
    model: CaseModel;
    hint: HintSetting;
    mode: CoordinatorMode;
    repeat: number;
    projectId: string;
    runId: string;
    settings: Readonly<{ preferences: unknown; models: unknown }>;
    observation: Observation;
    since: Baseline;
    stoppedBy: string;
    timings: Readonly<Record<string, number>>;
  }>,
) {
  const { observation, remark } = input;
  const moves = observation.moves;
  const personText = observation.stored?.personTexts[input.since.personTexts];
  const screens = moves.filter((move) => move.move.startsWith("open:"));
  const firstScreen = screens[0];
  const actOrAsk = moves.findIndex(
    (move) => move.move !== "read" && move.move !== "discover",
  );
  const firstRead = moves.findIndex((move) => move.move === "read");
  return {
    remark: remark.text,
    model: input.model.id,
    profile: input.model.profile,
    hint: input.hint,
    mode: input.mode,
    repeat: input.repeat,
    projectId: input.projectId,
    runId: input.runId,
    settings: input.settings,
    hintNote: personText === undefined ? null : hintNote(personText),
    moves,
    screen: firstScreen
      ? {
          firstValid: !firstScreen.refused,
          retryValid: firstScreen.refused
            ? screens[1] !== undefined && !screens[1].refused
            : null,
        }
      : null,
    readBeforeActing: firstRead >= 0 && (actOrAsk < 0 || firstRead < actOrAsk),
    assistantText: observation.textTurns,
    verdict: verdict(
      remark,
      moves.map((move) => move.move),
    ),
    stoppedBy: input.stoppedBy,
    storedConversation: observation.storedError
      ? `unreadable: ${observation.storedError}`
      : "read",
    timings: input.timings,
  };
}

export type CaseRecord = ReturnType<typeof recordCase>;
