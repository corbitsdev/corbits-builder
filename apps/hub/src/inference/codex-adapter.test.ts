import { expect, test } from "bun:test";
import { CODEX_RESPONSES_PATH } from "@corbits/codex-provider";
import type { LastCycleSource } from "@intx/types/runtime";
import { createCodexResponsesAdapter } from "./codex-adapter.ts";

const codexSource: LastCycleSource = {
  sourceId: "codex-default",
  provider: "codex",
  model: "gpt-6.1-sol",
};

test("enables parallel tool calls and repairs missing Codex Content-Type headers", async () => {
  const adapter = createCodexResponsesAdapter(codexSource, {
    productName: "Corbits Builder",
    environmentTagName: "builder_environment",
  });

  const request = adapter.buildRequest(
    [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: 0,
      },
    ],
    "gpt-6.1-sol",
    {
      effort: "max",
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    },
  );

  const body = JSON.parse(request.body) as Record<string, unknown>;
  expect(body["parallel_tool_calls"]).toBe(true);
  expect(body["store"]).toBe(false);
  expect(body["reasoning"]).toEqual({ effort: "max" });

  // A real server rather than a fetch stub: another test file may import the adapter first, and the repair then
  // wraps whatever fetch existed at that moment.
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(null, { status: 200 }),
  });
  const response = await globalThis.fetch(
    new URL(`backend-api${CODEX_RESPONSES_PATH}`, server.url),
    { headers: request.headers },
  );
  expect(response.headers.get("content-type")).toBe("text/event-stream");
});
