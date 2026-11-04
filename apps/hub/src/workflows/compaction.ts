import type {
  Compactor,
  ContentBlock,
  ConversationTurn,
} from "@intx/types/runtime";

export const COMPACTOR = "@corbits-builder/trim-history";
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

export const DROP_DEGENERATE = "@corbits-builder/drop-degenerate-turn";

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
