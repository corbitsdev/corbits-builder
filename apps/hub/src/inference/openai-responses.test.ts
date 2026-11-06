import { expect, test } from "bun:test";
import type { LastCycleSource } from "@intx/types/runtime";
import { createOpenAIResponsesAdapter } from "./openai-responses.ts";

const source: LastCycleSource = {
  sourceId: "openai-default",
  provider: "openai-responses",
  model: "gpt-6.1-terra",
};

test("tools are sent non-strict so their optional fields stay optional", () => {
  const request = createOpenAIResponsesAdapter(source).buildRequest(
    [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: 0,
      },
    ],
    "gpt-6.1-terra",
    {
      tools: [
        {
          name: "read_artifact",
          description: "Read a document",
          inputSchema: {
            type: "object",
            properties: { kind: { type: "string" } },
          },
        },
      ],
    },
  );

  const body = JSON.parse(request.body) as { tools: { strict?: boolean }[] };
  expect(body.tools[0]?.strict).toBe(false);
});
