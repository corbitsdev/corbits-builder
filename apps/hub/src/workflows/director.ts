import { deflateSync } from "node:zlib";
import { type } from "arktype";
import { defaultDirectorFactory, defineDirector } from "@intx/agent/authoring";
import type {
  ContentBlock,
  ConversationTurn,
  InferenceError,
  ReactorAction,
  ReactorDirector,
  RetryPolicy,
} from "@intx/types/runtime";
import { REPETITION_ABORT } from "../inference/repetition.ts";
import { readCheckDetail, type CheckDetail } from "../builds/check-detail.ts";
import { COMPACTOR, DROP_DEGENERATE } from "./compaction.ts";

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

const textOf = (blocks: readonly ContentBlock[]) =>
  blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

function isDegenerate(turn: ConversationTurn): boolean {
  if (
    turn.role !== "assistant" ||
    turn.content.some((block) => block.type === "tool_call")
  )
    return false;
  const text = textOf(turn.content);
  if (text.trim()) return compressesBelow(text, DEGENERATE_COMPRESSION);
  const thinking = turn.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("");
  return compressesBelow(thinking, DEGENERATE_REASONING_COMPRESSION);
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
  const { retryAfterMs } = error;
  if (
    !TRANSIENT_ERRORS.has(error.category) ||
    delayMs === undefined ||
    (error.category === "timeout" && attempt > TIMEOUT_RETRIES) ||
    (error.category !== "timeout" && elapsedMs > RETRY_BUDGET_MS) ||
    (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS)
  )
    return { kind: "abort" };
  if (retryAfterMs === undefined) return { kind: "retry", delayMs };
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
  const results = new Map<string, { detail: unknown; isError: boolean }>();
  const calls: {
    name: string;
    command: unknown;
    check: CheckDetail | undefined;
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
          detail: block.detail,
          isError: block.isError === true,
        });
      if (block.type === "tool_call") {
        const result = results.get(block.id);
        calls.push({
          name: block.name,
          command: (block.arguments as Record<string, unknown>)["command"],
          check: readCheckDetail(result?.detail),
          isError: result?.isError ?? true,
        });
      }
    }
  }
  return calls;
}

type TaskCall = ReturnType<typeof taskCalls>[number];

const ranShell = (call: TaskCall, pattern: RegExp) =>
  call.name === "run_shell" &&
  typeof call.command === "string" &&
  pattern.test(call.command);

// Run 36's coder passed check-app, kept editing, broke the app and would have replied done; a reply
// counts as done only when no file changed after the last passing check. check_design is the
// designer's check-app; file_design_option files only a design it passed as it stands.
function unchecked(turns: readonly ConversationTurn[]): boolean {
  for (const call of taskCalls(turns)) {
    if (call.check) return call.isError || !call.check.checkPassed;
    if (call.name === "file_design_option") return call.isError;
    if (WRITE_TOOLS.has(call.name) || ranShell(call, SHELL_WRITE)) return true;
  }
  return false;
}

const filed = (call: TaskCall) =>
  !call.isError &&
  (call.name === "write_artifact" ||
    call.name === "file_package" ||
    call.name === "file_design_option" ||
    call.check?.filed === true);

// A writer on 2026-10-30 replied with the whole approaches document as text and never filed it;
// the coordinator waited on a writer that had already answered. A designer's reply also waits for a
// filed design option after the last file change. A presenter files the approval package with
// file_package.
function unfiled(turns: readonly ConversationTurn[]): boolean {
  for (const call of taskCalls(turns)) {
    if (filed(call)) return false;
    if (WRITE_TOOLS.has(call.name) || ranShell(call, SHELL_WRITE)) return true;
  }
  return true;
}

function holdReply(
  config: { checkBeforeDone?: boolean; fileBeforeDone?: boolean },
  turns: readonly ConversationTurn[],
): string | undefined {
  if (config.checkBeforeDone && unchecked(turns))
    return "Files changed after the last passing check-app, so the work is not done yet.";
  if (config.fileBeforeDone && unfiled(turns)) {
    if (config.checkBeforeDone)
      return "The design option is not filed yet; check_design or file_design_option files it.";
    return "The document is not filed yet; write_artifact files it.";
  }
  return undefined;
}

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
            const notDone = replying
              ? holdReply(config, state.turns)
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
