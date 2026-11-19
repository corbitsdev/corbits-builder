import { defineTool } from "@intx/agent/authoring";
import { defineTools, type ToolEnv } from "@corbits-builder/plugin/tools";

// Calls the Keyholder API through the fetch Interchange mediates, which adds the saved key; the tool
// never sees the key and returns only what the API answered.
export default defineTools(() => [
  defineTool<ToolEnv>({
    id: "@corbits-builder/keyholder/tools",
    credentials: [{ handle: "keyholder-api" }],
    requires: ["capabilities"],
    definitions: [{ name: "check_keyholder" }],
    factory: (env) => ({
      definitions: [
        {
          name: "check_keyholder",
          description: "Check the Keyholder API and return what it answered.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      run: async (call) => {
        const api = await env.capabilities
          .resolve("credentials")
          .resolve("keyholder-api");
        if (api.kind !== "http")
          throw new Error("keyholder-api is not an http credential");
        const response = await api.fetch("/check");
        return {
          callId: call.id,
          content: JSON.stringify({
            status: response.status,
            body: await response.text(),
          }),
        };
      },
    }),
  }),
]);
