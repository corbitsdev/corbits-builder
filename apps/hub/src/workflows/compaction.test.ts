import { expect, test } from "bun:test";
import { createBlobReader } from "@intx/types/runtime";
import type { ConversationTurn, ReactorState } from "@intx/types/runtime";
import { trimHistory } from "./compaction.ts";

const state: ReactorState = {
  turns: [],
  activeForks: [],
  pendingOperations: [],
  activeGates: [],
  tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
  lastCycleUsage: null,
  lastCycleSource: null,
  sessionId: "session",
};

const ran = (
  callId: string,
  output: string,
  timestamp: number,
): ConversationTurn[] => [
  {
    role: "assistant",
    content: [
      {
        type: "tool_call",
        id: callId,
        name: "run_shell",
        arguments: { command: "check-app" },
      },
    ],
    timestamp,
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        callId,
        content: [{ type: "text", text: output }],
      },
    ],
    timestamp: timestamp + 1,
  },
];

const notes = (turns: ConversationTurn[]) =>
  turns
    .flatMap((turn) => turn.content)
    .flatMap((block) =>
      block.type === "tool_result" && block.content[0]?.type === "text"
        ? [block.content[0].text]
        : [],
    );

test("a trimmed tool result's note points at its whole output, saved where read_file finds it", async () => {
  // Gemini numbers calls from 0 in every response, so two results share the call id "0".
  const first = `check failed: 1 problem(s)${"\n✗ a rule".repeat(200)}`;
  const second = `check passed: built, started${"\n✓ a rule".repeat(200)}`;
  const spilled = `${"x".repeat(700)}\n[Tool output truncated: omitted 9000 chars. Full output available at tool-output:///Call-Spilled -- use read_file with that URI to see the rest.]`;
  const { output: turns, blobs } = await trimHistory(1).apply(
    [
      {
        role: "user",
        content: [{ type: "text", text: "Build the app." }],
        timestamp: 0,
      },
      ...ran("0", first, 10),
      ...ran("0", second, 20),
      ...ran("Call-Spilled", spilled, 30),
    ],
    { state, trigger: "context" },
  );

  if (!blobs) throw new Error("trim_saved_nothing");
  const saved = new Map(blobs.map((blob) => [blob.key, blob.bytes]));
  const reader = createBlobReader({
    readBlob: async (key) => {
      const bytes = saved.get(key);
      if (!bytes) throw new Error(`no blob ${key}`);
      return bytes;
    },
  });
  const [firstNote, secondNote, spilledNote] = notes(turns);
  const readBack = async (note = "") => {
    expect(note.length).toBeLessThan(600);
    const uri = note.match(/tool-output:\/\/\/\S+/)?.[0];
    if (!uri) throw new Error(`note_without_uri: ${note}`);
    return new TextDecoder().decode(await reader.read(uri));
  };
  expect(await readBack(firstNote)).toBe(first);
  expect(await readBack(secondNote)).toBe(second);

  // The size cap's own blob holds the whole output; the note points there and saves nothing over it.
  expect(spilledNote).toContain("read_file tool-output:///Call-Spilled ");
  expect(blobs).toHaveLength(2);
});
