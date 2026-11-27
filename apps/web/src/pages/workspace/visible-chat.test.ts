import { describe, expect, test } from "bun:test";
import type { ConversationPart } from "@corbits/react-ui";
import {
  sentItemId,
  turnItemId,
  withLiveTurn,
  withSteps,
  type TranscriptTurn,
} from "./visible-chat.ts";

const call = (toolCallId: string): ConversationPart => ({
  kind: "tool-trace",
  toolCallId,
  name: "execute",
  status: "output-available",
  input: { plugin: "writer", action: "write" },
});

const asked: TranscriptTurn = {
  role: "person",
  text: "Write the brief",
  at: 10,
};
const replied: TranscriptTurn = {
  role: "assistant",
  text: "The writer is on it.",
  at: 20,
};
const followed: TranscriptTurn = {
  role: "assistant",
  text: "The brief is filed.",
  at: 40,
};

describe("each reply with the work behind it", () => {
  test("what this session watched wins over the saved calls, and the reply's words follow its steps", () => {
    const turns = withSteps(
      [asked, replied],
      new Map([[20, [call("watched")]]]),
      new Map([[20, [call("saved")]]]),
    );
    expect(turns).toEqual([
      asked,
      {
        ...replied,
        parts: [call("watched"), { kind: "text", text: replied.text }],
      },
    ]);
  });

  test("a reply from before this session has its saved calls", () => {
    const [, turn] = withSteps(
      [asked, replied],
      new Map(),
      new Map([[20, [call("saved")]]]),
    );
    expect(turn?.parts).toEqual([
      call("saved"),
      { kind: "text", text: replied.text },
    ]);
  });

  test("a turn that already carries its parts, or has no work known, stays as it is", () => {
    const carrying: TranscriptTurn = {
      ...followed,
      parts: [{ kind: "text", text: followed.text }],
    };
    const turns = withSteps(
      [asked, replied, carrying],
      new Map([[40, [call("watched")]]]),
      new Map(),
    );
    expect(turns).toEqual([asked, replied, carrying]);
  });
});

describe("the live reply", () => {
  test("follows the committed turns, marked streaming while it is written", () => {
    const live = { text: "Checking", parts: [call("live")] };
    expect(withLiveTurn([asked], live, true)).toEqual([
      asked,
      {
        role: "assistant",
        text: "Checking",
        at: -1,
        parts: [call("live")],
        streaming: true,
      },
    ]);
  });

  test("with none, the turns are shown as they are", () => {
    const turns = [asked, replied];
    expect(withLiveTurn(turns, null, false)).toBe(turns);
  });
});

describe("the send the conversation pins", () => {
  test("the person's latest turn, once this session has sent one", () => {
    const turns = [asked, replied, { ...asked, at: 30 }, followed];
    expect(sentItemId(turns, true)).toBe(turnItemId({ ...asked, at: 30 }, 2));
  });

  test("nothing while every turn was loaded from the mirror", () => {
    expect(sentItemId([asked, replied], false)).toBeUndefined();
  });
});
