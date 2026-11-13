import { deflateSync } from "node:zlib";
import { type } from "arktype";
import { defaultDirectorFactory, defineDirector } from "@intx/agent/authoring";
import type {
  ConversationTurn,
  InferenceError,
  ReactorAction,
  ReactorDirector,
  ReactorInboundEvent,
  RetryPolicy,
  ToolCall,
} from "@intx/types/runtime";
import { COORDINATOR_NOTE_LEAD } from "@corbits-builder/schemas/native-specialist";
import { REPETITION_ABORT } from "../inference/repetition.ts";
import {
  DONE_CHECKS_TOOL,
  readCheckDetail,
  readDoneChecks,
  type CheckDetail,
  type DoneChecks,
} from "../builds/check-detail.ts";
import type { RunBlock } from "@corbits-builder/schemas/activity";
import { accessRefused } from "./http-json.ts";
import { BLOCKED_RULE, END_BLOCKED_RUN, REPORT_BLOCKED } from "./blocked.ts";
import {
  COMPACTOR,
  DROP_DEGENERATE,
  HELD_REPLY,
  isDirectorNote,
  REPEATED_FAILURE,
  textOf,
} from "./compaction.ts";

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
  const text = textOf(turn.content);
  if (text.trim()) return compressesBelow(text, DEGENERATE_COMPRESSION);
  const thinking = turn.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("");
  return compressesBelow(thinking, DEGENERATE_REASONING_COMPRESSION);
}

// A turn cut off while reasoning ends in a thinking block, which Anthropic refuses to take back
// (400 "The final block in an assistant message cannot be thinking").
const isCutOff = (turn: ConversationTurn) =>
  turn.role === "assistant" &&
  !turn.content.some(
    (block) =>
      block.type === "tool_call" ||
      (block.type === "text" && block.text.trim()),
  );

// A turn with two or more calls that ask the person runs its calls one at a time, the next once the
// one before has its result. A call that asks parks the run, and the run reports only the first call
// parked, so a second parked in the same batch was never asked about nor answered and the next
// inference failed on its unanswered call. The default director never sees such a batch, so every
// tool.done of it that reaches the default director infers.
function nextCall(
  event: ReactorInboundEvent,
  turns: ConversationTurn[],
  asks: ReadonlySet<string>,
): ToolCall | undefined {
  if (
    event.type !== "inference.done" &&
    event.type !== "tool.done" &&
    event.type !== "resume.tool_result"
  )
    return undefined;
  const at = turns.findLastIndex((turn) => turn.role === "assistant");
  const asking = turns[at]?.content.filter(
    (block) => block.type === "tool_call" && asks.has(block.name),
  );
  if (asking === undefined || asking.length < 2) return undefined;
  const answered = new Set(
    turns
      .slice(at + 1)
      .flatMap((turn) =>
        turn.content.flatMap((block) =>
          block.type === "tool_result" ? [block.callId] : [],
        ),
      ),
  );
  const call = turns[at]?.content.find(
    (block) => block.type === "tool_call" && !answered.has(block.id),
  );
  if (call?.type !== "tool_call") return undefined;
  return { id: call.id, name: call.name, arguments: call.arguments };
}

// A turn that spends the whole output budget reasoning ends with neither text nor a tool call, which
// left the designer parked, so the turn is dropped and sampled again, a few times.
const MAX_EMPTY_TURNS = 3;

// After this many held replies the run fails as not finished, so a model that cannot do the work is
// not held forever, and its reply never reaches the coordinator as a finished report.
const MAX_UNCHECKED_REPLIES = 3;

// What a held reply is told besides what is missing.
const FINISH_OR_SAY_WHY = ` Do that, then reply. If it cannot be done, reply saying why; after ${MAX_UNCHECKED_REPLIES} held replies the run ends as not finished, with your last reply as the reason.`;

// Why a run whose replies were held every time failed: what it did not do, and its last words.
const notFinished = (reason: string, lastWords: string) =>
  `not_finished: ${MAX_UNCHECKED_REPLIES + 1} replies in a row came before the work was done. ${reason} Its last reply: ${JSON.stringify(lastWords)}`;

// The checks a finished reply waits on: the checks of a plugin that its action's done names.
type Done = { plugin: string; checks: string[] };

// What a held reply is told of the done checks that failed on the app as saved, with their evidence.
function failedChecks(
  done: Done,
  ran: Extract<DoneChecks, { results: unknown }>,
): string | undefined {
  const failed = ran.results.filter(({ result }) => result === "fail");
  if (failed.length === 0) return undefined;
  const at = ran.commit === undefined ? "" : ` at commit ${ran.commit}`;
  const each = failed.map(
    ({ check, summary, evidence }) =>
      `${done.plugin} ${check} failed: ${summary}${evidence.length > 0 ? `\nEvidence:\n${evidence.join("\n")}` : ""}`,
  );
  return `Builder ran the checks the work must pass on the app as saved${at}, and ${each.join("\n\n")}\n\nFix the app so they pass; they run again on your next reply.`;
}

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
type Timeouts = { totalTimeoutMs?: number };

const withBackoff =
  (timeouts: Timeouts) =>
  (action: ReactorAction): ReactorAction =>
    action.type === "infer"
      ? {
          ...action,
          options: {
            ...action.options,
            retryPolicy: backoffRetryPolicy,
            ...timeouts,
          },
        }
      : action;

/**
 * Every inference retries on backoffRetryPolicy, under the source's timeouts; once it gives up,
 * with failRun the run fails.
 */
const withRetryPolicy = (
  director: ReactorDirector,
  failRun: boolean,
  timeouts: Timeouts,
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
    const stamp = withBackoff(timeouts);
    return Array.isArray(actions) ? actions.map(stamp) : stamp(actions);
  },
});

// Shell edits the done gate counts as changes: redirection into a file (not 2>&1 or >/dev/null),
// tee, sed -i, mv, cp, rm and touch.
const SHELL_WRITE =
  /(?<![0-9&])>>?\s*(?!&|\/dev\/null)\S|\b(tee|sed\s+-i|mv|cp|rm|touch)\b/;

const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
// A user turn that hands the agent a new task: mail, rather than a tool result or a director's note.
const isTask = (turn: ConversationTurn) =>
  turn.role === "user" &&
  turn.content.some(
    (block) => block.type === "text" && !isDirectorNote(block.text),
  );

// The current task's calls, newest first: everything after the last mail the agent was handed.
function taskCalls(turns: readonly ConversationTurn[]) {
  const results = new Map<string, { detail: unknown; isError: boolean }>();
  const calls: {
    name: string;
    command: unknown;
    check: CheckDetail | undefined;
    detail: unknown;
    isError: boolean;
  }[] = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (isTask(turn)) break;
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
          detail: result?.detail,
          isError: result?.isError ?? true,
        });
      }
    }
  }
  return calls;
}

type TaskCall = ReturnType<typeof taskCalls>[number];

// Whether one of the tool results the reply answers, those since the agent's last turn, was a
// refused access. Work the agent did after a refusal is held like any other. The newest turn is
// the reply itself.
function refusedBeforeReply(turns: readonly ConversationTurn[]): boolean {
  for (let index = turns.length - 2; index >= 0; index--) {
    const { role, content } = turns[index]!;
    if (role === "assistant") return false;
    if (
      content.some(
        (block) => block.type === "tool_result" && accessRefused(block.detail),
      )
    )
      return true;
  }
  return false;
}

const ranShell = (call: TaskCall, pattern: RegExp) =>
  call.name === "run_shell" &&
  typeof call.command === "string" &&
  pattern.test(call.command);

// Run 36's coder passed check-app, kept editing, broke the app and would have replied done; a reply
// counts as done only when no file changed after the last passing check. The coder's tools mark only
// its finish check, check-stack, as one. check_design is the designer's
// check-app; file_design_option files only a design it passed as it stands.
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

// The call that filed the task's work, unless a file changed after it. A writer can reply with its
// whole document as text and never file it, leaving the coordinator waiting on a writer that has
// already answered. A designer's reply also waits for a filed design option after the last file
// change. The approval package is filed with file_package.
function lastFiling(turns: readonly ConversationTurn[]): TaskCall | undefined {
  for (const call of taskCalls(turns)) {
    if (filed(call)) return call;
    if (WRITE_TOOLS.has(call.name) || ranShell(call, SHELL_WRITE))
      return undefined;
  }
  return undefined;
}

const unfiled = (turns: readonly ConversationTurn[]) =>
  lastFiling(turns) === undefined;

const DESIGN_CHOSEN_BY_BUILDER =
  "This design was chosen automatically because the person handed approvals over to Builder; they can ask to see or change it.";

// What a reply after filed work ends with: the screens that show it, or, for a design option Builder
// chose itself, that nobody needs to choose it; nothing when the work is not filed.
function filedEnding(
  turns: readonly ConversationTurn[],
  presents: string,
): string | undefined {
  const filing = lastFiling(turns);
  if (!filing) return undefined;
  return filing.check?.designChosen ? DESIGN_CHOSEN_BY_BUILDER : presents;
}

function holdReply(
  config: {
    checkBeforeDone?: boolean;
    fileBeforeDone?: boolean;
  },
  turns: readonly ConversationTurn[],
): string | undefined {
  // A refused access ends the agent's job: the reply it led to says what it finished, so nothing
  // holds it.
  if (refusedBeforeReply(turns)) return undefined;
  if (config.checkBeforeDone && unchecked(turns))
    return "Files changed after the last passing check, so the work is not done yet.";
  if (config.fileBeforeDone && unfiled(turns)) {
    if (config.checkBeforeDone)
      return "The design option is not filed yet; check_design or file_design_option files it.";
    return "The document is not filed yet; write_artifact files it.";
  }
  return undefined;
}

// Whether the agent reported a block in its current task, which its next reply ends the run on.
const reportedBlock = (turns: readonly ConversationTurn[]) =>
  taskCalls(turns).some(
    (call) => call.name === REPORT_BLOCKED && !call.isError,
  );

// A designer's file tools were refused 99 times for one reason it could not change. Three in a row
// is one past the twice the shared rule allows, so the agent is told once.
const NOTE_AFTER_FAILURES = 3;
// Three more after the note were three chances to change course, so the run ends.
const END_AFTER_FAILURES = 6;
// The repeated error is the recorded reason; a block's reason holds at most 2000 characters.
const FAILURE_QUOTE_CHARS = 500;

// A wait for mail that runs out of time only means no mail came yet; the agent waits again or
// moves on, which is no sign of being stuck.
const harmless = (tool: string | undefined, text: string) =>
  tool === "mail_wait" && text.includes("Timed out after");

const JsonCode = type({ code: "string > 0" });

// What a failed call's result says went wrong, as one key across tools: the code before the first
// colon of a refusal such as "artifact_write_refused: ...", or a JSON error body's code, else the
// whole text.
function failureKey(text: string): string {
  const code = /^([a-z][a-z0-9_.-]*):/.exec(text)?.[1];
  if (code !== undefined) return code;
  if (text.trimStart().startsWith("{")) {
    try {
      const body = JsonCode(JSON.parse(text));
      if (!(body instanceof type.errors)) return body.code;
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
    }
  }
  return text.trim().replaceAll(/\s+/g, " ");
}

/**
 * The newest tool results of the current task that failed the same way in a row, and the newest of
 * them. A success or a different failure ends the run of them; a harmless failure is skipped.
 */
function failureStreak(turns: readonly ConversationTurn[]) {
  const tools = new Map<string, string>();
  for (const turn of turns)
    for (const block of turn.content)
      if (block.type === "tool_call") tools.set(block.id, block.name);
  const streak = { count: 0, key: "", latest: "" };
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (isTask(turn)) return streak;
    for (const block of [...turn.content].reverse()) {
      if (block.type !== "tool_result") continue;
      const said = textOf(block.content);
      if (harmless(tools.get(block.callId), said)) continue;
      if (block.isError !== true) return streak;
      const key = failureKey(said);
      if (streak.count === 0) {
        streak.key = key;
        streak.latest = said;
      }
      if (key !== streak.key) return streak;
      streak.count += 1;
    }
  }
  return streak;
}

const quoted = (text: string) =>
  text.length > FAILURE_QUOTE_CHARS
    ? `${text.slice(0, FAILURE_QUOTE_CHARS)}…`
    : text;

// The note at the third identical failure; a role without the blocked exit is told only to change
// course.
const repeatedFailureNote = (latest: string, blocks: boolean) =>
  `${REPEATED_FAILURE}your last ${NOTE_AFTER_FAILURES} calls failed with the same error: ${JSON.stringify(quoted(latest))}. Trying again will not change it. Take a different approach${blocks ? `, or if nothing you can do changes it, report the block with ${REPORT_BLOCKED}` : ""}.`;

type Caps = Parameters<ReactorDirector["decide"]>[2];

/**
 * A director with the way out of work the agent cannot get past. With blocks, once the agent has
 * reported a block its next reply is let through whatever would hold it and ends the run. Three
 * tool results in a row that fail the same way get one note to change course; with blocks, six end
 * the run as blocked by Builder. A run ends as blocked by a stop, not a reply, so its assignment
 * stays unanswered and the coordinator gets the blocked note.
 */
function withBlockedExit(
  director: ReactorDirector,
  blocks: boolean,
): ReactorDirector {
  let endCall: string | undefined;
  let endings = 0;
  // Whether the current streak of identical failures has had its note.
  let noted = false;
  // Records Builder's own block first when given one.
  const endBlocked = (caps: Caps, block: RunBlock | Record<string, never>) => {
    endings += 1;
    endCall = `end-blocked-${endings}`;
    return [
      caps.checkpoint("blocked"),
      caps.executeTools(
        [{ id: endCall, name: END_BLOCKED_RUN, arguments: block }],
        false,
        false,
      ),
    ];
  };
  const brake = (turns: readonly ConversationTurn[], caps: Caps) => {
    const streak = failureStreak(turns);
    if (streak.count < NOTE_AFTER_FAILURES) {
      noted = false;
      return undefined;
    }
    if (blocks && streak.count >= END_AFTER_FAILURES)
      return endBlocked(caps, {
        reason: quoted(streak.latest),
        tried: `Ended by Builder after ${END_AFTER_FAILURES} identical failures in a row.`,
      });
    if (noted) return undefined;
    noted = true;
    return [
      caps.checkpoint("repeated-failures"),
      caps.compact(DROP_DEGENERATE, repeatedFailureNote(streak.latest, blocks)),
    ];
  };
  return {
    decide: async (event, state, caps) => {
      // The hub stops the run once its end is requested, so it waits for that rather than replying.
      if (event.type === "tool.done" && event.result.callId === endCall) {
        endCall = undefined;
        const { content, isError } = event.result;
        if (isError)
          throw new Error(
            `blocked_run_not_ended: ${typeof content === "string" ? content : JSON.stringify(content)}`,
          );
        return [caps.checkpoint("blocked-run-ending"), caps.wait()];
      }
      if (
        blocks &&
        event.type === "inference.done" &&
        !event.turn.content.some((block) => block.type === "tool_call") &&
        reportedBlock(state.turns)
      )
        return endBlocked(caps, {});
      const decided = await director.decide(event, state, caps);
      // After a turn's results, before the agent sees them.
      const infers = (Array.isArray(decided) ? decided : [decided]).some(
        (action) => action.type === "infer",
      );
      if (
        infers &&
        (event.type === "tool.done" || event.type === "resume.tool_result")
      )
        return brake(state.turns, caps) ?? decided;
      return decided;
    },
  };
}

/**
 * The default director, plus these rules. Once a turn's input passes compactAt of the model's context
 * window, it compacts before the next inference, and once more when the model refuses a request as
 * too long. A turn cut off with no text and no tool call is continued instead of parked, and a
 * turn that only repeats one sentence is dropped and sampled again, as is a stream the source adapter
 * cut for repeating one passage. The third such turn in one task fails the run, or with
 * replyOnFailure is the reply. With checkBeforeDone, a final reply waits for a passing finish check
 * after the last file change; with fileBeforeDone, it waits for a filed document; with done, a reply
 * those rules let out waits for the hub to run the named checks on the app as saved, and goes out
 * only when they pass. Each held reply is answered in the same conversation with what is missing,
 * and a fourth fails the run as not finished; done checks that could not be run twice in a row fail
 * it too. A reply after a Builder tool refused the agent's access is never held. With presents, a
 * reply after filed work ends with it, so the coordinator reads which screen shows the work, or with
 * a line that Builder chose the design itself when approvals are handed over. Every inference retries an
 * overloaded, slow or rate-limited model a few times; once that gives up, the run fails, or with
 * replyOnFailure the error is the reply. An agent offered report_blocked carries the shared rule on
 * using it, and once it has reported a block its next reply is not held and ends the run as blocked.
 * Three tool results in a row that fail the same way get one note to change course; with the
 * blocked exit, six end the run as blocked by Builder. The model-specific numbers come from the agent
 * definition's director config.
 */
export const compactingDirector = (packageName: string) =>
  defineDirector<{
    contextWindow: number;
    compactAt: number;
    // Whether a final reply waits for a passing finish check after the last file change.
    checkBeforeDone?: boolean;
    // Whether a final reply waits for a write_artifact that filed the task's document.
    fileBeforeDone?: boolean;
    // The checks the hub runs on the saved result before a final reply goes out.
    done?: Done;
    // Whether a runaway or a model failure is the reply rather than a failed run.
    replyOnFailure?: boolean;
    // What a reply after filed work ends with: the screen that shows the work to the person.
    presents?: string | null;
    // The tools offered with approval "ask", by the same policy that offers them.
    asks?: string[];
    // Timeouts every inference carries, where the source overrides Interchange's defaults.
    timeouts: Timeouts;
  }>({
    id: `${packageName}/compacting`,
    configSchema: type({
      contextWindow: "number.integer > 0",
      compactAt: "0 < number < 1",
      "checkBeforeDone?": "boolean",
      "fileBeforeDone?": "boolean",
      "done?": {
        "+": "reject",
        plugin: "string > 0",
        checks: type("string > 0").array().atLeastLength(1),
      },
      "replyOnFailure?": "boolean",
      "presents?": "string | null",
      "asks?": "string[]",
      timeouts: { "+": "reject", "totalTimeoutMs?": "number.integer > 0" },
    }),
    factory: (config, env, agent) => {
      // The done checks and ending a blocked run are the director's own calls, never the model's.
      const offered = agent.toolDefinitions.filter(
        (tool) =>
          tool.name !== DONE_CHECKS_TOOL && tool.name !== END_BLOCKED_RUN,
      );
      // A specialist has the blocked exit; the coordinator, which has no one above it to tell, does not.
      const blocks = offered.some((tool) => tool.name === REPORT_BLOCKED);
      const systemPrompt = blocks
        ? `${agent.systemPrompt}\n\n${BLOCKED_RULE}`
        : agent.systemPrompt;
      const inner = defaultDirectorFactory({}, env, {
        systemPrompt,
        toolDefinitions: offered,
        compactorNames: agent.compactorNames,
      }) as ReactorDirector;
      const asks = new Set(config.asks);
      const limit = Math.floor(config.contextWindow * config.compactAt);
      let compactedSinceInference = false;
      let emptyTurns = 0;
      let degenerateTurns = 0;
      let uncheckedReplies = 0;
      // The reply waiting on its done checks, by the call that runs them; the reply they passed; and
      // how many times in a row they could not be run.
      let checking:
        | {
            callId: string;
            replied: Extract<ReactorInboundEvent, { type: "inference.done" }>;
          }
        | undefined;
      let checkedTurn: ConversationTurn | undefined;
      let doneRuns = 0;
      let unrunChecks = 0;
      // A held reply is answered in the same conversation with what is missing; the fourth in a row
      // fails the run as not finished.
      const hold = (
        caps: Parameters<ReactorDirector["decide"]>[2],
        notDone: string,
        lastWords: string,
      ) => {
        uncheckedReplies += 1;
        if (uncheckedReplies > MAX_UNCHECKED_REPLIES)
          throw new Error(notFinished(notDone, lastWords));
        return [
          caps.checkpoint("reply-before-done"),
          caps.compact(
            DROP_DEGENERATE,
            HELD_REPLY + notDone + FINISH_OR_SAY_WHY,
          ),
        ];
      };
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
          const { done } = config;
          if (
            done &&
            event.type === "tool.done" &&
            event.result.callId === checking?.callId
          ) {
            const { replied } = checking;
            checking = undefined;
            const lastWords = textOf(replied.turn.content);
            const ran = readDoneChecks(event.result);
            const names = done.checks
              .map((check) => `${done.plugin} ${check}`)
              .join(", ");
            if ("unrun" in ran) {
              unrunChecks += 1;
              if (unrunChecks > 1)
                throw new Error(
                  `not_finished: ${names} could not be run on the app as saved: ${ran.unrun}. Its last reply: ${JSON.stringify(lastWords)}`,
                );
              return hold(
                caps,
                `Builder could not run ${names} on the app as saved, so the work is not known to be done: ${ran.unrun}.`,
                lastWords,
              );
            }
            unrunChecks = 0;
            const failed = failedChecks(done, ran);
            if (failed) return hold(caps, failed, lastWords);
            checkedTurn = replied.turn;
            return director.decide(replied, state, caps);
          }
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
                  systemPrompt,
                  tools: offered,
                  providerOptions: resample(),
                }),
              ];
            return runaways(caps);
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
            if (notDone) return hold(caps, notDone, textOf(event.turn.content));
            // The rules above passed; the hub runs the done checks before the reply goes out.
            if (
              replying &&
              done &&
              event.turn !== checkedTurn &&
              !refusedBeforeReply(state.turns)
            ) {
              doneRuns += 1;
              checking = { callId: `done-checks-${doneRuns}`, replied: event };
              return [
                caps.checkpoint("done-checks"),
                caps.executeTools(
                  [
                    {
                      id: checking.callId,
                      name: DONE_CHECKS_TOOL,
                      arguments: { plugin: done.plugin, checks: done.checks },
                    },
                  ],
                  false,
                  false,
                ),
              ];
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
          const next = nextCall(event, state.turns, asks);
          if (next)
            return [
              caps.checkpoint("tool-execution"),
              caps.executeTools([next], false),
            ];
          const decided = await inner.decide(event, state, caps);
          const list = Array.isArray(decided) ? decided : [decided];
          const ending = config.presents
            ? filedEnding(state.turns, config.presents)
            : undefined;
          const actions = ending
            ? list.map((action) =>
                action.type === "reply"
                  ? caps.reply(
                      `${action.content}${COORDINATOR_NOTE_LEAD}${ending}`,
                    )
                  : action,
              )
            : decided;
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
      return withRetryPolicy(
        withBlockedExit(director, blocks),
        !config.replyOnFailure,
        config.timeouts,
      );
    },
  });
