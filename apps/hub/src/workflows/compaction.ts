import { deflateSync } from "node:zlib";
import { type } from "arktype";
import { defaultDirectorFactory, defineDirector } from "@intx/agent/authoring";
import type {
  Compactor,
  ContentBlock,
  ConversationTurn,
  InferenceError,
  ReactorAction,
  ReactorDirector,
  RetryPolicy,
} from "@intx/types/runtime";
import { REPETITION_ABORT } from "../inference/repetition.ts";
import { CHECK_DESIGN_TOOL } from "../builds/design-check.ts";

const COMPACTOR = "@corbits-builder/trim-history";
// Old tool arguments and results longer than this are replaced by a note saying what they were. Never
// keep a clipped opening: a coder read its own clipped writes as broken files and spent a whole turn
// repeating "let me rewrite it cleanly".
const KEEP_CHARS = 600;

const elided = (length: number, what: string) =>
  `[${length} characters ${what}, not kept after compaction]`;

function elideValue(value: unknown): unknown {
  if (typeof value === "string")
    return value.length <= KEEP_CHARS
      ? value
      : elided(value.length, "written; the file holds them");
  if (Array.isArray(value)) return value.map(elideValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, elideValue(item)]),
    );
  return value;
}

function trimBlock(block: ContentBlock): ContentBlock | undefined {
  if (block.type === "thinking" || block.type === "redacted_thinking")
    return undefined;
  if (block.type === "tool_call")
    return {
      ...block,
      arguments: elideValue(block.arguments) as typeof block.arguments,
    };
  if (block.type === "tool_result")
    return {
      ...block,
      content: block.content.map((item) =>
        item.type === "text" && item.text.length > KEEP_CHARS
          ? {
              ...item,
              text: elided(
                item.text.length,
                "of an earlier result; run the tool again if it is still needed",
              ),
            }
          : item,
      ),
    };
  return block;
}

// Provider token counts on overflow against the characters of the prompt sent: 3.9 characters per
// token for the dev-stack coder (JSON-escaped code), 4.9 for board2's coordinator. Those counts
// include the system prompt and tools, so 3.5 overestimates the history alone.
const CHARS_PER_TOKEN = 3.5;
// The compacted history fills half the input room, so it can grow again before the next compaction.
const KEPT_SHARE = 0.5;
// Board2's coordinator kept nine reasoning-only turns of 125000 characters among its last 16 and
// overflowed ten times. Reasoning matters only while the model is still acting on it.
const REASONING_TURNS = 2;

const estimateTokens = (turns: readonly ConversationTurn[]) =>
  Math.ceil(
    turns.reduce((sum, turn) => sum + JSON.stringify(turn).length, 0) /
      CHARS_PER_TOKEN,
  );

const withoutReasoning = (turn: ConversationTurn): ConversationTurn => ({
  ...turn,
  content: turn.content.filter(
    (block) => block.type !== "thinking" && block.type !== "redacted_thinking",
  ),
});

/**
 * Keeps the task, and the newest turns that fit in half of inputTokens (the context window less the
 * completion reserve) as they are, with reasoning only on the last two assistant turns. From older
 * turns it drops the reasoning and replaces long tool arguments and results with a note of what
 * they were. Every turn and every call/result pair stays, so the history remains a valid conversation.
 */
export function trimHistory(inputTokens: number): Compactor {
  const budget = Math.floor(inputTokens * KEPT_SHARE);
  return {
    name: COMPACTOR,
    version: "3",
    apply: async (turns: ConversationTurn[]) => {
      let used = estimateTokens(turns.slice(0, 1));
      let assistantTurns = 0;
      let trimmedTurns = 0;
      const recentFirst = turns
        .slice(1)
        .reverse()
        .map((turn) => {
          const recent =
            turn.role === "assistant" && assistantTurns++ < REASONING_TURNS
              ? turn
              : withoutReasoning(turn);
          const cost = estimateTokens([recent]);
          if (trimmedTurns === 0 && used + cost <= budget) {
            used += cost;
            return recent;
          }
          trimmedTurns += 1;
          return {
            ...turn,
            content: turn.content.flatMap((block) => trimBlock(block) ?? []),
          };
        });
      const output = [...turns.slice(0, 1), ...recentFirst.reverse()];
      return {
        output,
        record: {
          strategy: COMPACTOR,
          version: "3",
          parameters: {
            budget,
            charsPerToken: CHARS_PER_TOKEN,
            keepChars: KEEP_CHARS,
          },
          reason: "context",
          decisions: {
            trimmedTurns,
            tokensBefore: estimateTokens(turns),
            tokensAfter: estimateTokens(output),
          },
        },
      };
    },
  };
}

const DROP_DEGENERATE = "@corbits-builder/drop-degenerate-turn";

// About 1 coder turn in 100 skipped reasoning and repeated one sentence ("Ok to write. Let me
// write.") for 220000 to 280000 characters until the output cap. The default director mailed it to
// the coordinator as the coder's reply and the build stopped. Replaying that exact prompt 18 times
// gave a tool call every time, so the turn is dropped and sampled again. Another coder had three
// 98000-character turns of "br>br>br>" with no sentence break, and a coordinator counted "Okay.
// 2390. Final. Done." upward; both compress below a fifth of their size, where the long reasoning
// in 128 kept traces compressed to between 0.04 and 0.44 and no long text-only turn was anything
// but a runaway.
const MAX_DEGENERATE_TURNS = 2;
// The sample after a cut stream is not the same request again: a fresh seed, and a presence
// penalty on tokens the new turn has already produced. Only the OpenAI-compatible adapter cuts a
// stream, and chat completions take seed and presence_penalty as request fields.
const RESAMPLE_PRESENCE_PENALTY = 0.5;
const resample = () => ({
  seed: Math.floor(Math.random() * 2 ** 31),
  presence_penalty: RESAMPLE_PRESENCE_PENALTY,
});
const DEGENERATE_TURNS = `model_degenerate_turns: ${MAX_DEGENERATE_TURNS + 1} turns in one task repeated one passage`;
const DEGENERATE_COMPRESSION = 0.2;
// A turn cut off while reasoning, with no text and no tool call. A designer reasoned in 90000
// characters of one emoji (about 0.005); a coordinator restated one question for nine
// 125000-character turns (0.016 to 0.029). Over 417 long reasoning blocks in 168 kept traces, every
// such runaway compressed below 0.035 and every other cut-off turn above 0.16; reasoning that ended
// in a reply went as low as 0.037, so a turn with text is judged by its text alone.
const DEGENERATE_REASONING_COMPRESSION = 0.08;

const compressesBelow = (text: string, ratio: number) =>
  text.length > 8000 &&
  deflateSync(text).length < Buffer.byteLength(text) * ratio;

function isDegenerate(turn: ConversationTurn): boolean {
  if (
    turn.role !== "assistant" ||
    turn.content.some((block) => block.type === "tool_call")
  )
    return false;
  const of = (kind: "text" | "thinking") =>
    turn.content
      .map((block) =>
        block.type === kind
          ? block.type === "text"
            ? block.text
            : block.thinking
          : "",
      )
      .join("");
  const text = of("text");
  return text.trim()
    ? compressesBelow(text, DEGENERATE_COMPRESSION)
    : compressesBelow(of("thinking"), DEGENERATE_REASONING_COMPRESSION);
}

// A turn cut off while reasoning ends in a thinking block, which Anthropic refuses to take back
// (400 "The final block in an assistant message cannot be thinking", run_517bbd62 on 2026-10-30).
const isCutOff = (turn: ConversationTurn) =>
  turn.role === "assistant" &&
  !turn.content.some(
    (block) =>
      block.type === "tool_call" ||
      (block.type === "text" && block.text.trim()),
  );

// Anthropic refuses to continue from an assistant turn ("does not support assistant message
// prefill", run_58cf9e8d on 2026-10-30), so a turn the director will not accept is dropped first.
/** Removes a final assistant turn without a tool call, so the next inference samples it again. */
export const dropDegenerateTurn: Compactor = {
  name: DROP_DEGENERATE,
  version: "4",
  apply: async (turns: ConversationTurn[]) => {
    const last = turns.at(-1);
    const drop =
      last?.role === "assistant" &&
      !last.content.some((block) => block.type === "tool_call");
    return {
      output: drop ? turns.slice(0, -1) : turns,
      record: {
        strategy: DROP_DEGENERATE,
        version: "4",
        parameters: {},
        reason: "unaccepted turn",
        decisions: {
          droppedChars: drop ? JSON.stringify(last.content).length : 0,
        },
      },
    };
  },
};

// A turn that spends the whole output budget reasoning ends with neither text nor a tool call, which
// left the designer parked, so the turn is dropped and sampled again, a few times.
const MAX_EMPTY_TURNS = 3;

// After this many held replies the reply goes out as it is, so a model that cannot pass is not held forever.
const MAX_UNCHECKED_REPLIES = 3;

const TRANSIENT_ERRORS: ReadonlySet<InferenceError["category"]> = new Set([
  "retryable",
  "timeout",
  "quota_exhausted",
]);
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
const TIMEOUT_RETRIES = 1;
// Each timed-out attempt already waited minutes, and every model source the reactor fails over to
// starts its own retries, so one call stops retrying after this long.
const RETRY_BUDGET_MS = 5 * 60_000;
const MAX_RETRY_AFTER_MS = 60_000;
/** Retries an overloaded, slow or rate-limited model on a growing schedule; a rate limit's retry-after wins when longer. */
const backoffRetryPolicy: RetryPolicy = ({ error, attempt, elapsedMs }) => {
  const delayMs = RETRY_DELAYS_MS[attempt - 1];
  const retryAfterMs = error.retryAfterMs ?? 0;
  if (
    !TRANSIENT_ERRORS.has(error.category) ||
    delayMs === undefined ||
    (error.category === "timeout" && attempt > TIMEOUT_RETRIES) ||
    elapsedMs > RETRY_BUDGET_MS ||
    retryAfterMs > MAX_RETRY_AFTER_MS
  )
    return { kind: "abort" };
  return { kind: "retry", delayMs: Math.max(delayMs, retryAfterMs) };
};
const withBackoff = (action: ReactorAction): ReactorAction =>
  action.type === "infer"
    ? {
        ...action,
        options: { ...action.options, retryPolicy: backoffRetryPolicy },
      }
    : action;

/** Every inference retries on backoffRetryPolicy; once it gives up, with failRun the run fails. */
const withRetryPolicy = (
  director: ReactorDirector,
  failRun: boolean,
): ReactorDirector => ({
  decide: async (event, state, caps) => {
    if (
      failRun &&
      event.type === "inference.error" &&
      TRANSIENT_ERRORS.has(event.error.category)
    )
      throw new Error(
        `model_unavailable: ${event.error.category}: ${event.error.message}`,
      );
    const actions = await director.decide(event, state, caps);
    return Array.isArray(actions)
      ? actions.map(withBackoff)
      : withBackoff(actions);
  },
});

// Shell edits the done gate counts as changes: redirection into a file (not 2>&1 or >/dev/null),
// tee, sed -i, mv, cp, rm and touch.
const SHELL_WRITE =
  /(?<![0-9&])>>?\s*(?!&|\/dev\/null)\S|\b(tee|sed\s+-i|mv|cp|rm|touch)\b/;

const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
// The current task's calls, newest first: everything after the last mail the agent was handed.
function taskCalls(turns: readonly ConversationTurn[]) {
  const results = new Map<string, { text: string; isError: boolean }>();
  const calls: {
    name: string;
    command: string;
    result: string;
    isError: boolean;
  }[] = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (
      turn.role === "user" &&
      turn.content.some((block) => block.type === "text")
    )
      break;
    for (const block of [...turn.content].reverse()) {
      if (block.type === "tool_result")
        results.set(block.callId, {
          text: block.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join(""),
          isError: block.isError === true,
        });
      if (block.type === "tool_call") {
        const command = (block.arguments as Record<string, unknown>)["command"];
        const result = results.get(block.id);
        calls.push({
          name: block.name,
          command: typeof command === "string" ? command : "",
          result: result?.text ?? "",
          isError: result?.isError ?? true,
        });
      }
    }
  }
  return calls;
}

// Run 36's coder passed check-app, kept editing, broke the app and would have replied done; a reply
// counts as done only when no file changed after the last passing check. check_design is the
// designer's check-app; file_design_option files only a design it passed as it stands.
function unchecked(turns: readonly ConversationTurn[]): boolean {
  for (const call of taskCalls(turns)) {
    if (call.name === "run_shell" && /check-app/.test(call.command))
      return !/check passed/.test(call.result);
    if (call.name === CHECK_DESIGN_TOOL)
      return !/check passed/.test(call.result);
    if (call.name === "file_design_option") return call.isError;
    if (
      WRITE_TOOLS.has(call.name) ||
      (call.name === "run_shell" && SHELL_WRITE.test(call.command))
    )
      return true;
  }
  return false;
}

// A writer on 2026-10-30 replied with the whole approaches document as text and never filed it;
// the coordinator waited on a writer that had already answered.
const unfiled = (turns: readonly ConversationTurn[]) =>
  !taskCalls(turns).some(
    (call) => call.name === "write_artifact" && !call.isError,
  );

/**
 * The default director, plus these rules. Once a turn's input passes compactAt of the model's context
 * window, it compacts before the next inference, and once more when the model refuses a request as
 * too long. A turn cut off with no text and no tool call is continued instead of parked, and a
 * turn that only repeats one sentence is dropped and sampled again, as is a stream the source adapter
 * cut for repeating one passage. The third such turn in one task fails the run, or with
 * replyOnFailure is the reply. With checkBeforeDone, a final reply waits for a passing check-app
 * after the last file change; with fileBeforeDone, it waits for a filed document. Every inference
 * retries an overloaded, slow or rate-limited model a few times; once that gives up, the run
 * fails, or with replyOnFailure the error is the reply. The model-specific numbers come from the
 * agent definition's director config.
 */
export const compactingDirector = (packageName: string) =>
  defineDirector<{
    contextWindow: number;
    compactAt: number;
    // Whether a final reply waits for a passing check-app after the last file change.
    checkBeforeDone?: boolean;
    // Whether a final reply waits for a write_artifact that filed the task's document.
    fileBeforeDone?: boolean;
    // Whether a runaway or a model failure is the reply rather than a failed run.
    replyOnFailure?: boolean;
  }>({
    id: `${packageName}/compacting`,
    configSchema: type({
      contextWindow: "number.integer > 0",
      compactAt: "0 < number < 1",
      "checkBeforeDone?": "boolean",
      "fileBeforeDone?": "boolean",
      "replyOnFailure?": "boolean",
    }),
    factory: (config, env, agent) => {
      const inner = defaultDirectorFactory({}, env, agent) as ReactorDirector;
      const limit = Math.floor(config.contextWindow * config.compactAt);
      let compactedSinceInference = false;
      let emptyTurns = 0;
      let degenerateTurns = 0;
      let uncheckedReplies = 0;
      let notDoneReason: string | undefined;
      // A thrown error is the reactor's fatal path (INFERENCE.md "Director Decision Function"): it
      // emits reactor.error and ends the run failed, which reaches the coordinator as a specialist
      // ended notice instead of a reply that reads as the specialist's result.
      const runaways = (caps: Parameters<ReactorDirector["decide"]>[2]) => {
        if (config.replyOnFailure)
          return [
            caps.checkpoint("degenerate-turns"),
            caps.reply(DEGENERATE_TURNS),
          ];
        throw new Error(DEGENERATE_TURNS);
      };
      const director: ReactorDirector = {
        decide: async (event, state, caps) => {
          if (event.type === "message.received") degenerateTurns = 0;
          // The source adapter cut a stream that repeated one passage; nothing of the turn was kept.
          if (
            event.type === "inference.error" &&
            event.error.category === "protocol_mismatch" &&
            event.error.message.startsWith(REPETITION_ABORT)
          ) {
            degenerateTurns += 1;
            if (degenerateTurns <= MAX_DEGENERATE_TURNS)
              return [
                caps.checkpoint("repetition-abort"),
                caps.infer({
                  systemPrompt: agent.systemPrompt,
                  tools: [...agent.toolDefinitions],
                  providerOptions: resample(),
                }),
              ];
            return runaways(caps);
          }
          if (event.type === "compaction.done" && notDoneReason) {
            const reason = notDoneReason;
            notDoneReason = undefined;
            return [
              caps.checkpoint("reply-before-done"),
              caps.infer({
                systemPrompt: `${agent.systemPrompt}\n\n${reason}`,
                tools: [...agent.toolDefinitions],
              }),
            ];
          }
          if (event.type === "inference.done") {
            compactedSinceInference = false;
            if (isDegenerate(event.turn)) {
              degenerateTurns += 1;
              if (degenerateTurns <= MAX_DEGENERATE_TURNS)
                return [
                  caps.checkpoint("degenerate-turn"),
                  caps.compact(DROP_DEGENERATE, "degenerate turn"),
                ];
              return runaways(caps);
            }
            const acted = !isCutOff(event.turn);
            emptyTurns = acted ? 0 : emptyTurns + 1;
            if (!acted && emptyTurns <= MAX_EMPTY_TURNS)
              return [
                caps.checkpoint("cut-off-turn"),
                caps.compact(DROP_DEGENERATE, "cut-off turn"),
              ];
            if (!acted)
              return [
                caps.checkpoint("cut-off-turns"),
                caps.reply(
                  `model_turns_cut_off: ${MAX_EMPTY_TURNS + 1} turns in a row spent the whole output budget without acting`,
                ),
              ];
            const replying = !event.turn.content.some(
              (block) => block.type === "tool_call",
            );
            const notDone =
              replying && config.checkBeforeDone && unchecked(state.turns)
                ? "Files changed after the last passing check-app, so the work is not done yet."
                : replying && config.fileBeforeDone && unfiled(state.turns)
                  ? "The document is not filed yet; write_artifact files it."
                  : undefined;
            if (notDone) {
              uncheckedReplies += 1;
              if (uncheckedReplies <= MAX_UNCHECKED_REPLIES) {
                notDoneReason = notDone;
                return [
                  caps.checkpoint("reply-before-done"),
                  caps.compact(DROP_DEGENERATE, "reply before done"),
                ];
              }
            }
            if (replying) uncheckedReplies = 0;
          }
          if (
            event.type === "inference.error" &&
            event.error.category === "context_overflow" &&
            !compactedSinceInference
          ) {
            compactedSinceInference = true;
            return [
              caps.checkpoint("context-overflow"),
              caps.compact(COMPACTOR, "context_overflow"),
            ];
          }
          const actions = await inner.decide(event, state, caps);
          const list = Array.isArray(actions) ? actions : [actions];
          const input = state.lastCycleUsage
            ? state.lastCycleUsage.input + state.lastCycleUsage.cacheRead
            : 0;
          if (
            !compactedSinceInference &&
            input > limit &&
            list.some((action) => action.type === "infer")
          ) {
            compactedSinceInference = true;
            return [
              caps.checkpoint("compact"),
              caps.compact(COMPACTOR, `input ${input} > ${limit}`),
            ];
          }
          return actions;
        },
      };
      return withRetryPolicy(director, !config.replyOnFailure);
    },
  });
