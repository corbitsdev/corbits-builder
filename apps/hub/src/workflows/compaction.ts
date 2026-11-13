import type {
  Compactor,
  ContentBlock,
  ConversationTurn,
  StrategyBlob,
} from "@intx/types/runtime";

export const COMPACTOR = "@corbits-builder/trim-history";
// Old tool arguments and results longer than this are replaced by a note. Never
// keep a clipped opening: a coder read its own clipped writes as broken files and spent a whole turn
// repeating "let me rewrite it cleanly".
const KEEP_CHARS = 600;

function elideValue(value: unknown): unknown {
  if (typeof value === "string")
    return value.length <= KEEP_CHARS
      ? value
      : `[${value.length} characters written; the file holds them, not kept after compaction]`;
  if (Array.isArray(value)) return value.map(elideValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, elideValue(item)]),
    );
  return value;
}

/** The text of a turn's or a tool result's blocks, joined. */
export const textOf = (blocks: readonly ContentBlock[]) =>
  blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

// A trimmed result is saved where the agent's read_file finds it, as the size cap's are; asking for a
// rerun cost the coder a whole check-app. The key carries the turn's time because a provider such as
// Gemini numbers calls from 0 in every response, so call ids repeat within one conversation. A result
// the size cap spilled is saved too: its spill is keyed by the bare call id, which a later spill overwrites.
function trimBlock(
  block: ContentBlock,
  timestamp: number,
  blobs: StrategyBlob[],
): ContentBlock[] {
  if (block.type === "thinking" || block.type === "redacted_thinking")
    return [];
  if (block.type === "tool_call")
    return [
      {
        ...block,
        arguments: elideValue(block.arguments) as typeof block.arguments,
      },
    ];
  if (block.type === "tool_result") {
    const long = (item: (typeof block.content)[number]) =>
      item.type === "text" && item.text.length > KEEP_CHARS;
    if (!block.content.some(long)) return [block];
    const text = textOf(block.content);
    const key = `trimmed-${timestamp}-${block.callId}`;
    blobs.push({
      key,
      bytes: new TextEncoder().encode(text),
      contentType: "text/plain",
    });
    const note = `[${text.length} characters of an earlier result, not kept after compaction; read_file tool-output:///${key} returns it]`;
    return [
      {
        ...block,
        content: block.content.map((item) =>
          item.type === "text" && long(item) ? { ...item, text: note } : item,
        ),
      },
    ];
  }
  return [block];
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
 * turns it drops the reasoning and replaces long tool arguments with a note of what they were, and
 * long tool results with a note of where read_file finds them whole. Every turn and every
 * call/result pair stays, so the history remains a valid conversation.
 */
export function trimHistory(inputTokens: number): Compactor {
  const budget = Math.floor(inputTokens * KEPT_SHARE);
  return {
    name: COMPACTOR,
    version: "4",
    apply: async (turns: ConversationTurn[]) => {
      let used = estimateTokens(turns.slice(0, 1));
      let assistantTurns = 0;
      let trimmedTurns = 0;
      const blobs: StrategyBlob[] = [];
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
            content: turn.content.flatMap((block) =>
              trimBlock(block, turn.timestamp, blobs),
            ),
          };
        });
      const output = [...turns.slice(0, 1), ...recentFirst.reverse()];
      return {
        output,
        record: {
          strategy: COMPACTOR,
          version: "4",
          parameters: {
            budget,
            charsPerToken: CHARS_PER_TOKEN,
            keepChars: KEEP_CHARS,
          },
          reason: "context",
          decisions: {
            trimmedTurns,
            savedResults: blobs.length,
            tokensBefore: estimateTokens(turns),
            tokensAfter: estimateTokens(output),
          },
        },
        blobs,
      };
    },
  };
}

export const DROP_DEGENERATE = "@corbits-builder/drop-degenerate-turn";

// How the director's note on a held reply opens. The compactor finds the note in the compaction's
// reason by it, and the director reads a turn that opens with it as part of the same task.
export const HELD_REPLY =
  "Builder held your reply, so no one has read it yet: ";

const heldNote = (trigger: string) => {
  const at = trigger.indexOf(HELD_REPLY);
  return at === -1 ? undefined : trigger.slice(at);
};

// Anthropic refuses to continue from an assistant turn ("does not support assistant message
// prefill"), so a turn the director will not accept is dropped first.
// A held reply stays instead, answered by the director's note, so the agent continues the same
// conversation knowing why and is not handed its assignment again as if new.
/**
 * Removes a final assistant turn without a tool call, so the next inference samples it again; for a
 * held reply, adds the director's note after it.
 */
export const dropDegenerateTurn: Compactor = {
  name: DROP_DEGENERATE,
  version: "5",
  apply: async (turns: ConversationTurn[], { trigger }) => {
    const last = turns.at(-1);
    const note = heldNote(trigger);
    const drop =
      note === undefined &&
      last?.role === "assistant" &&
      !last.content.some((block) => block.type === "tool_call");
    let output = drop ? turns.slice(0, -1) : turns;
    if (note !== undefined)
      output = [
        ...turns,
        {
          role: "user",
          content: [{ type: "text", text: note }],
          timestamp: Date.now(),
        },
      ];
    return {
      output,
      record: {
        strategy: DROP_DEGENERATE,
        version: "5",
        parameters: {},
        reason: note === undefined ? "unaccepted turn" : "held reply",
        decisions: {
          droppedChars: drop ? JSON.stringify(last.content).length : 0,
        },
      },
    };
  },
};
