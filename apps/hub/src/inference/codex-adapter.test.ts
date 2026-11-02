import { expect, test } from "bun:test";
import { CODEX_RESPONSES_PATH } from "@corbits/codex-provider";
import type { LastCycleSource } from "@intx/types/runtime";

const originalFetch = globalThis.fetch;
let stubResponse: Response | undefined;
globalThis.fetch = Object.assign(
  async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    if (stubResponse !== undefined) return stubResponse;
    return originalFetch(input, init);
  },
  { preconnect: originalFetch.preconnect },
);

const { createCodexResponsesAdapter } = await import("./codex-adapter.ts");

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

  stubResponse = new Response(null, { status: 200 });
  try {
    const response = await globalThis.fetch(
      `https://chatgpt.com/backend-api${CODEX_RESPONSES_PATH}`,
      { headers: request.headers },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  } finally {
    stubResponse = undefined;
  }
});
