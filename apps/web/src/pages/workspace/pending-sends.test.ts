import { expect, test } from "bun:test";
import { maxTurnText } from "@corbits-builder/schemas/conversation";
import {
  latestTurnAt,
  SENDING,
  withPendingSends,
  type SentMessage,
} from "./pending-sends.ts";

const typed = "First line  \r\nsecond line\t\n\nthird";
const asDelivered = "First line\nsecond line\n\nthird";
const notes = {
  kind: "file" as const,
  name: "notes.txt",
  mediaType: "text/plain",
};

const sent = (
  id: string,
  body = typed,
  more: Partial<SentMessage> = {},
): SentMessage => ({
  id,
  author: "me",
  body,
  at: new Date(5).toISOString(),
  after: 1,
  ...more,
});

test("a sent message shows once when the conversation holds it as mail delivered it", () => {
  const turns = withPendingSends(
    [{ role: "person", text: asDelivered, at: 9 }],
    [sent("message-1")],
  );
  expect(turns).toEqual([{ role: "person", text: asDelivered, at: 9 }]);
});

test("a sent message longer than a turn shows once when the conversation holds it clipped", () => {
  const long = "a".repeat(maxTurnText + 10);
  const clipped = long.slice(0, maxTurnText);
  expect(
    withPendingSends(
      [{ role: "person", text: clipped, at: 9 }],
      [sent("message-1", long)],
    ),
  ).toEqual([{ role: "person", text: clipped, at: 9 }]);
});

test("a sent message shows its files while sending and once the conversation holds it", () => {
  const withNotes = sent(`${SENDING}1`, typed, { files: [notes] });
  expect(withPendingSends([], [withNotes])).toEqual([
    {
      role: "person",
      text: typed,
      at: 5,
      sending: true,
      parts: [notes, { kind: "text", text: typed }],
    },
  ]);
  expect(
    withPendingSends(
      [{ role: "person", text: asDelivered, at: 9 }],
      [withNotes],
    ),
  ).toEqual([
    {
      role: "person",
      text: asDelivered,
      at: 9,
      parts: [notes, { kind: "text", text: asDelivered }],
    },
  ]);
});

test("a repeated message shows as new, with its files, beside the earlier turn with its words", () => {
  const earlier = { role: "person" as const, text: "yes", at: 3 };
  const reply = { role: "assistant" as const, text: "Noted.", at: 4 };
  const repeated = sent(`${SENDING}2`, "yes", { after: 4, files: [notes] });
  expect(withPendingSends([earlier, reply], [repeated])).toEqual([
    earlier,
    reply,
    {
      role: "person",
      text: "yes",
      at: 5,
      sending: true,
      parts: [notes, { kind: "text", text: "yes" }],
    },
  ]);
  expect(
    withPendingSends(
      [earlier, reply, { role: "person", text: "yes", at: 6 }],
      [sent("message-1", "yes"), repeated],
    ),
  ).toEqual([
    earlier,
    reply,
    {
      role: "person",
      text: "yes",
      at: 6,
      parts: [notes, { kind: "text", text: "yes" }],
    },
  ]);
});

test("a participant turn with the same words does not take the person's sent message", () => {
  expect(
    withPendingSends(
      [
        { role: "participant", sender: "writer", text: asDelivered, at: 7 },
        { role: "person", text: asDelivered, at: 9 },
      ],
      [sent("message-1", typed, { files: [notes] })],
    ),
  ).toEqual([
    { role: "participant", sender: "writer", text: asDelivered, at: 7 },
    {
      role: "person",
      text: asDelivered,
      at: 9,
      parts: [notes, { kind: "text", text: asDelivered }],
    },
  ]);
});

test("a message is sent after the latest person or assistant turn, ignoring participants, and before every turn of an empty conversation", () => {
  expect(
    latestTurnAt([
      { role: "person", text: "hi", at: 3 },
      { role: "assistant", text: "Hello.", at: 4 },
      { role: "participant", sender: "writer", text: "Done.", at: 8 },
    ]),
  ).toBe(4);
  expect(latestTurnAt([])).toBe(Number.NEGATIVE_INFINITY);
});
