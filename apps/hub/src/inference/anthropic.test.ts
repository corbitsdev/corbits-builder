import { expect, test } from "bun:test";
import type { ContentBlock, LastCycleSource } from "@intx/types/runtime";
import { createAnthropicAdapter } from "./anthropic.ts";

const source: LastCycleSource = {
  sourceId: "anthropic-default",
  provider: "anthropic",
  model: "claude-opus-5-5",
};

function sentBlock(block: ContentBlock): unknown {
  const request = createAnthropicAdapter(source).buildRequest(
    [{ role: "user", content: [block], timestamp: 0 }],
    "claude-opus-5-5",
    {},
  );
  const body: { messages: { content: unknown[] }[] } = JSON.parse(request.body);
  return body.messages[0]?.content[0];
}

const text = "name,qty\nbolt,3\n";

test.each(["text/plain", "text/csv", "text/markdown", "application/json"])(
  "a %s attachment is sent as a text document, not base64",
  (mimeType) => {
    const sent = sentBlock({
      type: "document",
      title: "notes",
      source: {
        kind: "base64",
        mimeType,
        data: Buffer.from(text).toString("base64"),
      },
    });

    expect(sent).toMatchObject({
      type: "document",
      title: "notes",
      source: { type: "text", media_type: "text/plain", data: text },
      cache_control: { type: "ephemeral" },
    });
  },
);

test("a PDF is sent as base64 exactly as before", () => {
  const sent = sentBlock({
    type: "document",
    source: { kind: "base64", mimeType: "application/pdf", data: "JVBERi0=" },
  });

  expect(sent).toMatchObject({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
  });
});
